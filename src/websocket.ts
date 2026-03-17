import { Buffer } from 'node:buffer';
import { WebSocketError } from './errors';
import { Headers } from './headers';
import {
  nativeWebSocketClose,
  nativeWebSocketConnect,
  nativeWebSocketRead,
  nativeWebSocketSendBinary,
  nativeWebSocketSendText,
  validateBrowserProfile,
} from './native';
import type {
  CookieJar,
  HeadersInit,
  NativeWebSocketReadResult,
  WebSocketBinaryType,
  WebSocketInit,
} from './types';

const SUBPROTOCOL_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DEFAULT_TIMEOUT = 30_000;
const FORBIDDEN_WEBSOCKET_HEADERS = new Set([
  'connection',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-protocol',
  'sec-websocket-version',
  'upgrade',
]);

function appendQuery(url: URL, query: WebSocketInit['query']): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    url.searchParams.set(key, String(value));
  }
}

function resolveWebSocketUrl(rawUrl: string | URL, init?: WebSocketInit): string {
  const url = init?.baseURL ? new URL(String(rawUrl), init.baseURL) : new URL(String(rawUrl));
  appendQuery(url, init?.query);

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new WebSocketError(`Invalid WebSocket URL protocol: ${url.protocol}`);
  }

  if (url.hash) {
    throw new DOMException('WebSocket URL must not include a fragment', 'SyntaxError');
  }

  return url.toString();
}

function normalizeHeaders(headers?: HeadersInit): Headers {
  const normalized = headers instanceof Headers ? new Headers(headers) : new Headers(headers);

  for (const [name] of normalized) {
    if (FORBIDDEN_WEBSOCKET_HEADERS.has(name.toLowerCase())) {
      throw new DOMException(`Forbidden WebSocket header: ${name}`, 'SyntaxError');
    }
  }

  return normalized;
}

function normalizeProtocols(protocols?: string | string[]): string[] {
  if (!protocols) {
    return [];
  }

  const values = Array.isArray(protocols) ? protocols : [protocols];
  const seen = new Set<string>();

  for (const value of values) {
    if (!SUBPROTOCOL_PATTERN.test(value)) {
      throw new SyntaxError(`Invalid WebSocket subprotocol: ${value}`);
    }

    if (seen.has(value)) {
      throw new SyntaxError(`Duplicate WebSocket subprotocol: ${value}`);
    }

    seen.add(value);
  }

  return values;
}

async function loadCookiesIntoHeaders(
  cookieJar: CookieJar | undefined,
  url: string,
  headers: Headers
) {
  if (!cookieJar || headers.has('cookie')) {
    return;
  }

  const cookies = await cookieJar.getCookies(url);
  if (cookies.length === 0) {
    return;
  }

  headers.set('cookie', cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '));
}

function validateCloseCode(code: number): void {
  if (code === 1000) {
    return;
  }

  if (code >= 3000 && code <= 4999) {
    return;
  }

  throw new DOMException(`Invalid WebSocket close code: ${code}`, 'InvalidAccessError');
}

function validateCloseReason(reason: string): void {
  if (Buffer.byteLength(reason) > 123) {
    throw new DOMException('WebSocket close reason must be 123 bytes or fewer', 'SyntaxError');
  }
}

async function normalizeSendData(data: string | Blob | ArrayBuffer | ArrayBufferView): Promise<
  | {
      type: 'text';
      data: string;
    }
  | {
      type: 'binary';
      data: Uint8Array;
    }
> {
  if (typeof data === 'string') {
    return {
      type: 'text',
      data,
    };
  }

  if (data instanceof Blob) {
    return {
      type: 'binary',
      data: new Uint8Array(await data.arrayBuffer()),
    };
  }

  if (ArrayBuffer.isView(data)) {
    return {
      type: 'binary',
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    };
  }

  if (data instanceof ArrayBuffer) {
    return {
      type: 'binary',
      data: new Uint8Array(data),
    };
  }

  throw new TypeError('Unsupported WebSocket message type');
}

function toMessageEventData(
  result: NativeWebSocketReadResult,
  binaryType: WebSocketBinaryType
): unknown {
  switch (result.type) {
    case 'text': {
      return result.data;
    }
    case 'binary': {
      if (binaryType === 'arraybuffer') {
        const bytes = result.data;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }

      return new Blob([result.data]);
    }
    case 'close': {
      throw new TypeError('Close frames cannot be converted to message events');
    }
  }
}

type OpenHandler = ((event: Event) => void) | null;
type MessageHandler = ((event: MessageEvent) => void) | null;
type CloseHandler = ((event: CloseEvent) => void) | null;
type ErrorHandler = ((event: Event) => void) | null;

export class CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;

  constructor(type: string, init?: { code?: number; reason?: string; wasClean?: boolean }) {
    super(type);
    this.code = init?.code ?? 1005;
    this.reason = init?.reason ?? '';
    this.wasClean = init?.wasClean ?? false;
  }
}

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
    return 0;
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

    if (this.#readyState === WebSocket.CONNECTING) {
      this.#readyState = WebSocket.CLOSING;
    } else {
      this.#readyState = WebSocket.CLOSING;
    }

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

  async #connect(init: WebSocketInit, headers: Headers, protocols: string[]): Promise<void> {
    await loadCookiesIntoHeaders(init.cookieJar, this.url, headers);

    try {
      const connection = await nativeWebSocketConnect({
        url: this.url,
        headers: headers.toObject(),
        browser: init.browser,
        proxy: init.proxy,
        timeout: init.timeout ?? DEFAULT_TIMEOUT,
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
