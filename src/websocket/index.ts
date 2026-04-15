import { serializeEmulationOptions } from '../config/emulation';
import { normalizeDnsOptions, normalizeProxyOptions } from '../config/network';
import { normalizeCertificateAuthority, normalizeTlsIdentity } from '../config/tls';
import { WebSocketError } from '../errors';
import { loadCookiesIntoHeaders } from '../http/pipeline/cookies';
import {
  nativeWebSocketClose,
  nativeWebSocketConnect,
  nativeWebSocketRead,
  nativeWebSocketSendBinary,
  nativeWebSocketSendText,
  validateBrowserProfile,
} from '../native';
import type { WebSocketBinaryType, WebSocketInit } from '../types';
import { CloseEvent } from './close-event';
import { getSendByteLength, normalizeSendData, toMessageEventData } from './send-data';
import {
  normalizeHeaders,
  normalizeProtocols,
  resolveWebSocketUrl,
  validateCloseCode,
  validateCloseReason,
} from './validation';

const DEFAULT_TIMEOUT = 30_000;

type OpenHandler = ((event: Event) => void) | null;
type MessageHandler = ((event: MessageEvent) => void) | null;
type CloseHandler = ((event: CloseEvent) => void) | null;
type ErrorHandler = ((event: Event) => void) | null;

export { CloseEvent };

export class WebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;

  readonly url: string;
  readonly extensions: string;
  readonly opened: Promise<void>;
  #resolveOpened!: () => void;
  #rejectOpened!: (reason?: unknown) => void;
  #readyState = WebSocket.CONNECTING;
  #handle?: number;
  #protocol = '';
  #binaryType: WebSocketBinaryType;
  #bufferedAmount = 0;
  #sendQueue = Promise.resolve();
  #settled = false;
  #onopen: OpenHandler = null;
  #onmessage: MessageHandler = null;
  #onclose: CloseHandler = null;
  #onerror: ErrorHandler = null;

  constructor(url: string | URL, init: WebSocketInit = {}) {
    super();

    this.url = resolveWebSocketUrl(url, init);
    validateBrowserProfile(init.browser);
    const headers = normalizeHeaders(init.headers);
    const protocols = normalizeProtocols(init.protocols);

    if (protocols.length > 0 && headers.has('sec-websocket-protocol')) {
      throw new DOMException(
        'Do not provide sec-websocket-protocol header when protocols option is used',
        'SyntaxError'
      );
    }
    this.extensions = '';
    this.#binaryType = init.binaryType ?? 'blob';
    this.opened = new Promise<void>((resolve, reject) => {
      this.#resolveOpened = resolve;
      this.#rejectOpened = reject;
    });

    void this.#connect(init, headers, protocols);
  }

  get readyState(): number {
    return this.#readyState;
  }

  get protocol(): string {
    return this.#protocol;
  }

  get binaryType(): WebSocketBinaryType {
    return this.#binaryType;
  }

  set binaryType(value: WebSocketBinaryType) {
    if (value !== 'blob' && value !== 'arraybuffer') {
      throw new TypeError(`Invalid WebSocket binaryType: ${value}`);
    }

    this.#binaryType = value;
  }

  get bufferedAmount(): number {
    return this.#bufferedAmount;
  }

  get onopen(): OpenHandler {
    return this.#onopen;
  }

  set onopen(handler: OpenHandler) {
    this.#setEventHandler('open', this.#onopen, handler);
    this.#onopen = handler;
  }

  get onmessage(): MessageHandler {
    return this.#onmessage;
  }

  set onmessage(handler: MessageHandler) {
    this.#setEventHandler('message', this.#onmessage, handler);
    this.#onmessage = handler;
  }

  get onclose(): CloseHandler {
    return this.#onclose;
  }

  set onclose(handler: CloseHandler) {
    this.#setEventHandler('close', this.#onclose, handler);
    this.#onclose = handler;
  }

  get onerror(): ErrorHandler {
    return this.#onerror;
  }

  set onerror(handler: ErrorHandler) {
    this.#setEventHandler('error', this.#onerror, handler);
    this.#onerror = handler;
  }

  send(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
    if (this.#readyState !== WebSocket.OPEN || this.#handle === undefined) {
      throw new DOMException('WebSocket is not open', 'InvalidStateError');
    }

    const queuedBytes = getSendByteLength(data);

    this.#bufferedAmount += queuedBytes;
    this.#sendQueue = this.#sendQueue
      .then(async () => {
        const normalized = await normalizeSendData(data);

        if (this.#readyState !== WebSocket.OPEN || this.#handle === undefined) {
          throw new DOMException('WebSocket is not open', 'InvalidStateError');
        }

        if (normalized.type === 'text') {
          await nativeWebSocketSendText(this.#handle, normalized.data);

          return;
        }

        await nativeWebSocketSendBinary(this.#handle, normalized.data);
      })
      .catch((error: unknown) => {
        this.#handleError(error);
      })
      .finally(() => {
        this.#bufferedAmount = Math.max(0, this.#bufferedAmount - queuedBytes);
      });
  }

  close(code?: number, reason = ''): void {
    if (code !== undefined) {
      validateCloseCode(code);
    }

    validateCloseReason(reason);

    if (this.#readyState === WebSocket.CLOSING || this.#readyState === WebSocket.CLOSED) {
      return;
    }

    this.#readyState = WebSocket.CLOSING;

    if (this.#handle === undefined) {
      return;
    }

    const handle = this.#handle;

    this.#handle = undefined;

    void nativeWebSocketClose(handle, code, reason)
      .then(() => {
        this.#finalizeClose({
          code: code ?? 1000,
          reason,
          wasClean: true,
        });
      })
      .catch((error: unknown) => {
        this.#handleError(error);
        this.#finalizeClose({
          code: code ?? 1006,
          reason,
          wasClean: false,
        });
      });
  }

  async #connect(
    init: WebSocketInit,
    headers: import('../headers').Headers,
    protocols: string[]
  ): Promise<void> {
    await loadCookiesIntoHeaders(init.cookieJar, this.url, headers);

    try {
      const { proxy, disableSystemProxy } = normalizeProxyOptions(init.proxy);
      const connection = await nativeWebSocketConnect({
        url: this.url,
        headers: headers.toTuples(),
        origHeaders: headers.toOriginalNames(),
        browser: init.browser,
        emulationJson: serializeEmulationOptions(init),
        proxy,
        disableSystemProxy,
        dns: normalizeDnsOptions(init.dns),
        timeout: init.timeout ?? DEFAULT_TIMEOUT,
        disableDefaultHeaders: init.disableDefaultHeaders ?? false,
        tlsIdentity: normalizeTlsIdentity(init.tlsIdentity),
        ca: normalizeCertificateAuthority(init.ca),
        protocols,
      });

      this.#handle = connection.handle;
      this.#protocol = connection.protocol ?? '';
      if (connection.protocol && protocols.length > 0 && !protocols.includes(connection.protocol)) {
        throw new WebSocketError(`Server selected unexpected subprotocol: ${connection.protocol}`);
      }

      (this as { extensions: string }).extensions = connection.extensions ?? '';
      this.#readyState = WebSocket.OPEN;
      this.#resolveOpened();
      this.dispatchEvent(new Event('open'));
      void this.#pumpMessages();
    } catch (error) {
      this.#handleError(error);
      this.#finalizeClose({
        code: 1006,
        reason: '',
        wasClean: false,
      });
    }
  }

  async #pumpMessages(): Promise<void> {
    while (this.#readyState === WebSocket.OPEN && this.#handle !== undefined) {
      try {
        const result = await nativeWebSocketRead(this.#handle);

        if (result.type === 'close') {
          this.#handle = undefined;
          this.#finalizeClose(result);

          return;
        }

        this.dispatchEvent(
          new MessageEvent('message', {
            data: toMessageEventData(result, this.#binaryType),
          })
        );
      } catch (error) {
        this.#handleError(error);
        this.#handle = undefined;
        this.#finalizeClose({
          code: 1006,
          reason: '',
          wasClean: false,
        });

        return;
      }
    }
  }

  #setEventHandler(
    type: string,
    current: ((event: any) => void) | null,
    next: ((event: any) => void) | null
  ): void {
    if (current) {
      this.removeEventListener(type, current);
    }

    if (next) {
      this.addEventListener(type, next);
    }
  }

  #handleError(error: unknown): void {
    const event = new Event('error');

    Object.defineProperty(event, 'error', {
      configurable: true,
      enumerable: false,
      value: error instanceof Error ? error : new WebSocketError(String(error)),
      writable: false,
    });

    if (this.#readyState === WebSocket.CONNECTING) {
      this.#rejectOpened(error);
    }

    this.dispatchEvent(event);
  }

  #finalizeClose(init: { code: number; reason: string; wasClean: boolean }): void {
    if (this.#settled) {
      return;
    }

    this.#settled = true;
    this.#readyState = WebSocket.CLOSED;
    if (this.#handle !== undefined) {
      this.#handle = undefined;
    }

    if (init.wasClean === false) {
      this.#rejectOpened(new WebSocketError('WebSocket connection closed before opening'));
    }

    this.dispatchEvent(new CloseEvent('close', init));
  }
}

export async function websocket(url: string | URL, init?: WebSocketInit): Promise<WebSocket> {
  const socket = new WebSocket(url, init);

  await socket.opened;

  return socket;
}
