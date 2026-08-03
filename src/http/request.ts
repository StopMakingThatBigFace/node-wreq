import type { BodyInit, HeadersInit, NativeMultipartUpload, WreqInit } from '../types';
import { Buffer } from 'node:buffer';
import { ReadableStream } from 'node:stream/web';
import { Headers } from '../headers';
import { normalizeMethod } from '../native';
import {
  cloneBodyInit,
  cloneBytes,
  createMultipartRequest,
  isBlobBody,
  isFormDataBody,
  isReadableStreamBody,
  MultipartBody,
  StreamingBody,
  toReadableStreamBody,
  toBodyBytes,
} from './body/bytes';
import { parseResponseFormData } from './body/form-data';

function isGlobalRequest(value: unknown): value is globalThis.Request {
  return (
    typeof globalThis.Request !== 'undefined' &&
    value instanceof globalThis.Request &&
    !(value instanceof Request)
  );
}

/** WHATWG-style request wrapper used by the public API. */
export class Request {
  /** Fully resolved request URL. */
  readonly url: string;
  /** Normalized HTTP method. */
  readonly method: string;
  /** Request headers. */
  readonly headers: Headers;
  /** Abort signal associated with the request, if any. */
  readonly signal: AbortSignal;
  /** Cache mode exposed for Fetch API compatibility. */
  readonly cache: globalThis.Request['cache'];
  /** Credentials mode exposed for Fetch API compatibility. */
  readonly credentials: globalThis.Request['credentials'];
  /** Request destination exposed for Fetch API compatibility. */
  readonly destination: globalThis.Request['destination'];
  /** Subresource integrity metadata. */
  readonly integrity: string;
  /** Whether the request is eligible to outlive its initiating context. */
  readonly keepalive: boolean;
  /** Fetch mode exposed for compatibility. */
  readonly mode: globalThis.Request['mode'];
  /** Redirect mode used by the request. */
  readonly redirect: globalThis.Request['redirect'];
  /** Request referrer. */
  readonly referrer: string;
  /** Referrer policy used by the request. */
  readonly referrerPolicy: globalThis.Request['referrerPolicy'];
  /** Streaming request duplex mode. */
  readonly duplex = 'half' as const;
  #bodyBytes: Uint8Array | null;
  #multipartBody: MultipartBody | null;
  #streamingBody: StreamingBody | null;
  #bodyUsed = false;
  #stream: ReadableStream<Uint8Array> | null = null;
  #transferredBodyReaders: ReadableStreamDefaultReader<Uint8Array>[] = [];

  constructor(input: string | URL | Request | globalThis.Request, init: WreqInit = {}) {
    const inputRequest = input instanceof Request || isGlobalRequest(input) ? input : undefined;

    if (inputRequest?.bodyUsed && init.body === undefined) {
      throw new TypeError('Request body is already used');
    }

    const inputUrl = inputRequest?.url ?? String(input);
    let parsedUrl: URL;

    try {
      parsedUrl = init.baseURL ? new URL(inputUrl, init.baseURL) : new URL(inputUrl);
    } catch {
      throw new TypeError(`Invalid request URL: ${inputUrl}`);
    }

    if (parsedUrl.username || parsedUrl.password) {
      throw new TypeError('Request URL must not include credentials');
    }

    this.url = parsedUrl.toString();
    this.method = normalizeMethod(init.method === undefined ? inputRequest?.method : init.method);
    this.headers = new Headers(init.headers ?? inputRequest?.headers);
    this.signal = init.signal ?? inputRequest?.signal ?? new AbortController().signal;
    this.cache = init.cache ?? inputRequest?.cache ?? 'default';
    this.credentials = init.credentials ?? inputRequest?.credentials ?? 'same-origin';
    this.destination = inputRequest?.destination ?? '';
    this.integrity = init.integrity ?? inputRequest?.integrity ?? '';
    this.keepalive = init.keepalive ?? inputRequest?.keepalive ?? false;
    this.mode = init.mode ?? inputRequest?.mode ?? 'cors';
    this.redirect = init.redirect ?? inputRequest?.redirect ?? 'follow';
    this.referrer = init.referrer ?? inputRequest?.referrer ?? 'about:client';
    this.referrerPolicy = init.referrerPolicy ?? inputRequest?.referrerPolicy ?? '';
    this.#bodyBytes = null;
    this.#multipartBody = null;
    this.#streamingBody = null;

    const inheritedBody =
      init.body === undefined &&
      (input instanceof Request ? input.#hasBody() : isGlobalRequest(input) && input.body !== null);

    if (
      (this.method === 'GET' || this.method === 'HEAD') &&
      (init.body !== undefined && init.body !== null ? true : inheritedBody)
    ) {
      throw new TypeError('Request with GET/HEAD method cannot have body.');
    }

    if (init.body !== undefined) {
      this.#setBody(init.body, init.multipartBoundary);
    } else if (input instanceof Request) {
      const boundary = init.multipartBoundary ?? input.#multipartBody?.boundary;

      this.#setBody(input._takeBodyInit(), boundary, init.multipartBoundary !== undefined);
    } else if (isGlobalRequest(input) && input.body) {
      const transferred = new globalThis.Request(input, { method: this.method });

      this.#setBody(transferred.body as ReadableStream<Uint8Array> | null, init.multipartBoundary);
    }
  }

  /** Returns the request body as a readable byte stream. */
  get body(): globalThis.Request['body'] {
    if (!this.#hasBody()) {
      return null;
    }

    if (this.#streamingBody) {
      return this.#streamingBody.stream as globalThis.Request['body'];
    }

    let emitted = false;

    this.#stream ??= new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          this.#bodyUsed = true;

          if (!emitted) {
            emitted = true;
            controller.enqueue(await this.#readBodyBytes());
          }

          controller.close();
        },
        cancel: () => {
          this.#bodyUsed = true;
        },
      },
      { highWaterMark: 0 }
    );

    return this.#stream as globalThis.Request['body'];
  }

  /** Indicates whether the request body has already been consumed. */
  get bodyUsed(): boolean {
    return this.#bodyUsed || this.#streamingBody?.bodyUsed === true;
  }

  /** Creates a clone whose body can be consumed independently. */
  clone(): Request {
    if (this.bodyUsed || this.#stream?.locked || this.#streamingBody?.locked) {
      throw new TypeError('Request body is already used');
    }

    const cloned = new Request(this.url, {
      method: this.method,
      headers: this.headers,
      signal: this.signal ?? undefined,
      cache: this.cache,
      credentials: this.credentials,
      integrity: this.integrity,
      keepalive: this.keepalive,
      mode: this.mode,
      redirect: this.redirect,
      referrer: this.referrer,
      referrerPolicy: this.referrerPolicy,
    });

    cloned.#bodyBytes = cloneBytes(this.#bodyBytes);
    cloned.#multipartBody = this.#multipartBody?.clone() ?? null;
    cloned.#streamingBody = this.#streamingBody?.clone() ?? null;

    return cloned;
  }

  /** Reads the request body as UTF-8 text. */
  async text(): Promise<string> {
    return Buffer.from(await this.#consumeBytes()).toString('utf8');
  }

  /** Reads the request body as JSON. */
  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }

  /** Reads the request body as an `ArrayBuffer`. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    return Uint8Array.from(await this.#consumeBytes()).buffer;
  }

  /** Reads the request body as bytes. */
  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await this.#consumeBytes());
  }

  /** Reads the request body as a `Blob`. */
  async blob(): Promise<Blob> {
    return new globalThis.Blob([await this.#consumeBytes()], {
      type: this.headers.get('content-type') ?? '',
    });
  }

  /** Reads the request body as `FormData`. */
  async formData(): Promise<FormData> {
    if (this.#multipartBody) {
      if (this.#bodyUsed) {
        throw new TypeError('Request body is already used');
      }

      this.#bodyUsed = true;

      return this.#multipartBody.clone().formData();
    }

    const contentType = this.headers.get('content-type') ?? '';

    return parseResponseFormData(await this.#consumeBytes(), contentType);
  }

  /** Internal helper that clones the encoded request body bytes. */
  async _cloneBodyBytes(): Promise<Uint8Array | null> {
    if (this.#bodyBytes !== null) {
      return cloneBytes(this.#bodyBytes);
    }

    if (!this.#multipartBody) {
      return null;
    }

    return new Uint8Array(await this.#multipartBody.clone().arrayBuffer());
  }

  /** Internal helper that transfers ownership of the body to a new request. */
  _takeBodyInit(): BodyInit | null {
    if (this.bodyUsed || this.#stream?.locked || this.#streamingBody?.locked) {
      throw new TypeError('Request body is already used');
    }

    let body: BodyInit | null = null;

    if (this.#bodyBytes !== null) {
      body = cloneBytes(this.#bodyBytes);
    } else if (this.#multipartBody) {
      body = this.#multipartBody.cloneFormData();
    } else if (this.#streamingBody) {
      body = this.#streamingBody.transfer().stream;
    }

    if (body !== null) {
      const originalStream = this.body;

      this.#bodyUsed = true;

      if (originalStream) {
        this.#transferredBodyReaders.push(originalStream.getReader());
      }
    }

    return body;
  }

  /** Internal helper that returns the explicit multipart boundary, when applicable. */
  _getMultipartBoundary(): string | undefined {
    return this.#multipartBody?.boundary;
  }

  /** Internal helper that prepares a native streaming multipart upload. */
  _prepareMultipartUpload(): NativeMultipartUpload | undefined {
    return this.#multipartBody?.prepareNativeUpload();
  }

  /** Internal helper that prepares a native streaming raw-body upload. */
  _prepareBodyStreamUpload(): import('../types').NativeBodyStreamUpload | undefined {
    return this.#streamingBody?.prepareNativeUpload();
  }

  /** Internal helper that prepares body bytes for native dispatch. */
  async _getBodyBytesForDispatch(): Promise<Uint8Array | undefined> {
    if (this.#streamingBody) {
      return undefined;
    }

    return (await this._cloneBodyBytes()) ?? undefined;
  }

  /** Internal helper that creates a modified request copy. */
  _replace(input: {
    url?: string;
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
  }): Request {
    const hasBodyOverride = Object.prototype.hasOwnProperty.call(input, 'body');
    const next = new Request(input.url ?? this.url, {
      method: input.method ?? this.method,
      headers: input.headers ?? this.headers,
      signal: this.signal ?? undefined,
      body: hasBodyOverride ? input.body : undefined,
    });

    if (!hasBodyOverride) {
      next.#bodyBytes = cloneBytes(this.#bodyBytes);
      next.#multipartBody = this.#multipartBody?.clone() ?? null;
      next.#streamingBody = this.#streamingBody?.clone() ?? null;
    }

    return next;
  }

  #setBody(
    body: BodyInit | null | undefined,
    multipartBoundary?: string,
    overwriteMultipartContentType = multipartBoundary !== undefined
  ): void {
    const nextBody = toReadableStreamBody(body) ?? cloneBodyInit(body);

    this.#stream = null;

    if (nextBody === null) {
      this.#bodyBytes = null;
      this.#multipartBody = null;
      this.#streamingBody = null;

      return;
    }

    if (isFormDataBody(nextBody)) {
      const multipartBody = createMultipartRequest(nextBody, multipartBoundary);

      this.#bodyBytes = null;
      this.#multipartBody = multipartBody;
      this.#streamingBody = null;

      if (overwriteMultipartContentType || !this.headers.has('content-type')) {
        this.headers.set('content-type', multipartBody.contentType);
      }

      return;
    }

    if (isBlobBody(nextBody) || isReadableStreamBody(nextBody)) {
      const streamingBody = new StreamingBody(nextBody);

      this.#bodyBytes = null;
      this.#multipartBody = null;
      this.#streamingBody = streamingBody;

      if (streamingBody.contentType && !this.headers.has('content-type')) {
        this.headers.set('content-type', streamingBody.contentType);
      }

      return;
    }

    this.#bodyBytes = toBodyBytes(nextBody, 'Unsupported request body type');
    this.#multipartBody = null;
    this.#streamingBody = null;

    if (!this.headers.has('content-type')) {
      if (typeof nextBody === 'string') {
        this.headers.set('content-type', 'text/plain;charset=UTF-8');
      } else if (nextBody instanceof URLSearchParams) {
        this.headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
      }
    }
  }

  async #readBodyBytes(): Promise<Uint8Array> {
    if (this.#bodyBytes !== null) {
      return cloneBytes(this.#bodyBytes) ?? new Uint8Array();
    }

    if (this.#multipartBody) {
      return new Uint8Array(await this.#multipartBody.clone().arrayBuffer());
    }

    if (this.#streamingBody) {
      return this.#readStreamBytes(this.#streamingBody.stream);
    }

    return new Uint8Array();
  }

  async #consumeBytes(): Promise<Uint8Array> {
    if (this.bodyUsed || this.#stream?.locked || this.#streamingBody?.locked) {
      throw new TypeError('Request body is already used');
    }

    if (this.#streamingBody) {
      return this.#readStreamBytes(this.#streamingBody.stream);
    }

    this.#bodyUsed = true;

    return this.#readBodyBytes();
  }

  #hasBody(): boolean {
    return this.#bodyBytes !== null || this.#multipartBody !== null || this.#streamingBody !== null;
  }

  async #readStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      chunks.push(result.value);
    }

    return new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  }
}
