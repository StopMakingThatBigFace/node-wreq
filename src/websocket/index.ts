import { serializeEmulationOptions } from '../config/emulation';
import {
  normalizeDnsOptions,
  normalizeLocalBindOptions,
  normalizeProxyOptions,
} from '../config/network';
import {
  normalizeCertificateAuthority,
  normalizeTlsDanger,
  normalizeTlsDebug,
  normalizeTlsIdentity,
} from '../config/tls';
import { WebSocketError } from '../errors';
import { loadCookiesIntoHeaders } from '../http/pipeline/cookies';
import {
  nativeWebSocketClose,
  nativeWebSocketConnect,
  nativeWebSocketRead,
  nativeWebSocketSendBinary,
  nativeWebSocketSendText,
  validateBrowserProfile,
} from '../native/index';
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

function resolveNativeTimeout(
  timeout: number | undefined
): Pick<import('../types').NativeWebSocketConnectOptions, 'timeout'> {
  if (timeout === undefined) {
    return { timeout: DEFAULT_TIMEOUT };
  }

  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError('timeout must be a finite non-negative number');
  }

  return { timeout: timeout === 0 ? 0 : Math.max(1, Math.ceil(timeout)) };
}

function resolveNativeWebSocketSize(
  value: number | undefined,
  name: 'maxFrameSize' | 'maxMessageSize'
): Partial<
  Pick<import('../types').NativeWebSocketConnectOptions, 'maxFrameSize' | 'maxMessageSize'>
> {
  if (value === undefined) {
    return {};
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite positive number`);
  }

  return { [name]: Math.max(1, Math.ceil(value)) };
}

function resolveNativeWebSocketBufferSize(
  value: number | undefined,
  name: 'readBufferSize' | 'writeBufferSize' | 'maxWriteBufferSize'
): Partial<
  Pick<
    import('../types').NativeWebSocketConnectOptions,
    'readBufferSize' | 'writeBufferSize' | 'maxWriteBufferSize'
  >
> {
  if (value === undefined) {
    return {};
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite positive number`);
  }

  return { [name]: Math.max(1, Math.ceil(value)) };
}

type OpenHandler = ((event: Event) => void) | null;
type MessageHandler = ((event: MessageEvent) => void) | null;
type CloseHandler = ((event: CloseEvent) => void) | null;
type ErrorHandler = ((event: Event) => void) | null;

export { CloseEvent };

/** Browser-style WebSocket implementation backed by the native transport. */
export class WebSocket extends EventTarget {
  /** Connecting state constant. */
  static readonly CONNECTING = 0;
  /** Open state constant. */
  static readonly OPEN = 1;
  /** Closing state constant. */
  static readonly CLOSING = 2;
  /** Closed state constant. */
  static readonly CLOSED = 3;

  /** Connecting state constant exposed on instances. */
  readonly CONNECTING = WebSocket.CONNECTING;
  /** Open state constant exposed on instances. */
  readonly OPEN = WebSocket.OPEN;
  /** Closing state constant exposed on instances. */
  readonly CLOSING = WebSocket.CLOSING;
  /** Closed state constant exposed on instances. */
  readonly CLOSED = WebSocket.CLOSED;

  /** Final connected WebSocket URL. */
  readonly url: string;
  /** Negotiated extensions string returned by the server. */
  readonly extensions: string;
  /** Promise resolved when the connection reaches the open state. */
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

  /** Creates and starts connecting a new WebSocket instance. */
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

  /** Current WebSocket ready state. */
  get readyState(): number {
    return this.#readyState;
  }

  /** Negotiated subprotocol, or an empty string when none was selected. */
  get protocol(): string {
    return this.#protocol;
  }

  /** Binary representation used for incoming binary messages. */
  get binaryType(): WebSocketBinaryType {
    return this.#binaryType;
  }

  /** Updates the binary representation used for incoming binary messages. */
  set binaryType(value: WebSocketBinaryType) {
    if (value !== 'blob' && value !== 'arraybuffer') {
      throw new TypeError(`Invalid WebSocket binaryType: ${value}`);
    }

    this.#binaryType = value;
  }

  /** Number of bytes queued for sending but not yet flushed. */
  get bufferedAmount(): number {
    return this.#bufferedAmount;
  }

  /** Event handler invoked when the socket opens. */
  get onopen(): OpenHandler {
    return this.#onopen;
  }

  /** Registers an event handler invoked when the socket opens. */
  set onopen(handler: OpenHandler) {
    this.#setEventHandler('open', this.#onopen, handler);
    this.#onopen = handler;
  }

  /** Event handler invoked when a message is received. */
  get onmessage(): MessageHandler {
    return this.#onmessage;
  }

  /** Registers an event handler invoked when a message is received. */
  set onmessage(handler: MessageHandler) {
    this.#setEventHandler('message', this.#onmessage, handler);
    this.#onmessage = handler;
  }

  /** Event handler invoked when the socket closes. */
  get onclose(): CloseHandler {
    return this.#onclose;
  }

  /** Registers an event handler invoked when the socket closes. */
  set onclose(handler: CloseHandler) {
    this.#setEventHandler('close', this.#onclose, handler);
    this.#onclose = handler;
  }

  /** Event handler invoked when the socket reports an error. */
  get onerror(): ErrorHandler {
    return this.#onerror;
  }

  /** Registers an event handler invoked when the socket reports an error. */
  set onerror(handler: ErrorHandler) {
    this.#setEventHandler('error', this.#onerror, handler);
    this.#onerror = handler;
  }

  /** Queues a text or binary message for sending. */
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

  /** Starts the closing handshake. */
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
      const localBind = normalizeLocalBindOptions(init);
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
        ...resolveNativeTimeout(init.timeout),
        disableDefaultHeaders: init.disableDefaultHeaders ?? false,
        tlsIdentity: normalizeTlsIdentity(init.tlsIdentity),
        ca: normalizeCertificateAuthority(init.ca),
        tlsDebug: normalizeTlsDebug(init.tlsDebug),
        tlsDanger: normalizeTlsDanger(init.tlsDanger),
        protocols,
        forceHttp2: init.forceHttp2,
        acceptUnmaskedFrames: init.acceptUnmaskedFrames,
        ...resolveNativeWebSocketBufferSize(init.readBufferSize, 'readBufferSize'),
        ...resolveNativeWebSocketBufferSize(init.writeBufferSize, 'writeBufferSize'),
        ...resolveNativeWebSocketBufferSize(init.maxWriteBufferSize, 'maxWriteBufferSize'),
        ...resolveNativeWebSocketSize(init.maxFrameSize, 'maxFrameSize'),
        ...resolveNativeWebSocketSize(init.maxMessageSize, 'maxMessageSize'),
        ...localBind,
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

/** Connects a WebSocket and resolves once the socket is open. */
export async function websocket(url: string | URL, init?: WebSocketInit): Promise<WebSocket> {
  const socket = new WebSocket(url, init);

  await socket.opened;

  return socket;
}
