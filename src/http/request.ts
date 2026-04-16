import { Blob, Buffer } from 'node:buffer';
import { ReadableStream } from 'node:stream/web';
import { Headers } from '../headers';
import type { BodyInit, HeadersInit, WreqInit } from '../types';
import {
  cloneBodyInit,
  cloneBytes,
  createMultipartRequest,
  isFormDataBody,
  toBodyBytes,
} from './body/bytes';

/** WHATWG-style request wrapper used by the public API. */
export class Request {
  /** Fully resolved request URL. */
  readonly url: string;
  /** Uppercased HTTP method. */
  readonly method: string;
  /** Request headers. */
  readonly headers: Headers;
  /** Abort signal associated with the request, if any. */
  readonly signal: AbortSignal | null;
  #bodyBytes: Uint8Array | null;
  #multipartBody: globalThis.Request | null;
  #bodyUsed = false;
  #stream: ReadableStream<Uint8Array> | null = null;

  constructor(input: string | URL | Request, init: WreqInit = {}) {
    if (input instanceof Request) {
      if (input.bodyUsed) {
        throw new TypeError('Request body is already used');
      }

      this.url = String(init.baseURL ? new URL(input.url, init.baseURL) : input.url);
      this.method = (init.method ?? input.method).toUpperCase();
      this.headers = new Headers(init.headers ?? input.headers);
      this.signal = init.signal ?? input.signal ?? null;
      this.#bodyBytes = null;
      this.#multipartBody = null;

      if (init.body !== undefined) {
        this.#setBody(init.body);
      } else {
        this.#bodyBytes = cloneBytes(input.#bodyBytes);
        this.#multipartBody = input.#multipartBody?.clone() ?? null;
      }

      return;
    }

    this.url = String(init.baseURL ? new URL(String(input), init.baseURL) : input);
    this.method = (init.method ?? 'GET').toUpperCase();
    this.headers = new Headers(init.headers);
    this.signal = init.signal ?? null;
    this.#bodyBytes = null;
    this.#multipartBody = null;
    this.#setBody(init.body);
  }

  /** Returns the request body as a readable byte stream. */
  get body(): ReadableStream<Uint8Array> | null {
    if (this.#bodyUsed || (this.#bodyBytes === null && this.#multipartBody === null)) {
      return null;
    }

    this.#bodyUsed = true;
    this.#stream ??= new ReadableStream<Uint8Array>({
      start: async (controller) => {
        controller.enqueue(await this.#readBodyBytes());
        controller.close();
      },
    });

    return this.#stream;
  }

  /** Indicates whether the request body has already been consumed. */
  get bodyUsed(): boolean {
    return this.#bodyUsed;
  }

  /** Creates a clone whose body can be consumed independently. */
  clone(): Request {
    if (this.#bodyUsed) {
      throw new TypeError('Request body is already used');
    }

    const cloned = new Request(this.url, {
      method: this.method,
      headers: this.headers,
      signal: this.signal ?? undefined,
    });

    cloned.#bodyBytes = cloneBytes(this.#bodyBytes);
    cloned.#multipartBody = this.#multipartBody?.clone() ?? null;

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

  /** Reads the request body as a `Blob`. */
  async blob(): Promise<Blob> {
    return new Blob([await this.#consumeBytes()]);
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

    const contentType = this.headers.get('content-type')?.toLowerCase() ?? '';

    if (!contentType.includes('application/x-www-form-urlencoded')) {
      throw new TypeError(`Request content-type is not form data: ${contentType || 'unknown'}`);
    }

    const formData = new FormData();
    const searchParams = new URLSearchParams(await this.text());

    for (const [name, value] of searchParams) {
      formData.append(name, value);
    }

    return formData;
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

  /** Internal helper that prepares body bytes for native dispatch. */
  async _getBodyBytesForDispatch(): Promise<Uint8Array | undefined> {
    return (await this._cloneBodyBytes()) ?? undefined;
  }

  /** Internal helper that marks the request body as consumed. */
  _markBodyUsed(): void {
    if (this.#bodyBytes !== null || this.#multipartBody !== null) {
      this.#bodyUsed = true;
    }
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
    }

    return next;
  }

  #setBody(body: BodyInit | null | undefined): void {
    const nextBody = cloneBodyInit(body);

    this.#stream = null;

    if (nextBody === null) {
      this.#bodyBytes = null;
      this.#multipartBody = null;

      return;
    }

    if (isFormDataBody(nextBody)) {
      const multipartBody = createMultipartRequest(nextBody);
      const contentType = multipartBody.headers.get('content-type');

      this.#bodyBytes = null;
      this.#multipartBody = multipartBody;

      if (contentType) {
        this.headers.set('content-type', contentType);
      }

      return;
    }

    this.#bodyBytes = toBodyBytes(nextBody, 'Unsupported request body type');
    this.#multipartBody = null;
  }

  async #readBodyBytes(): Promise<Uint8Array> {
    if (this.#bodyBytes !== null) {
      return cloneBytes(this.#bodyBytes) ?? new Uint8Array();
    }

    if (this.#multipartBody) {
      return new Uint8Array(await this.#multipartBody.clone().arrayBuffer());
    }

    return new Uint8Array();
  }

  async #consumeBytes(): Promise<Uint8Array> {
    if (this.#bodyUsed) {
      throw new TypeError('Request body is already used');
    }

    this.#bodyUsed = true;

    return this.#readBodyBytes();
  }
}
