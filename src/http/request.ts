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

export class Request {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
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

  get bodyUsed(): boolean {
    return this.#bodyUsed;
  }

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

  async text(): Promise<string> {
    return Buffer.from(await this.#consumeBytes()).toString('utf8');
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return Uint8Array.from(await this.#consumeBytes()).buffer;
  }

  async blob(): Promise<Blob> {
    return new Blob([await this.#consumeBytes()]);
  }

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

  async _cloneBodyBytes(): Promise<Uint8Array | null> {
    if (this.#bodyBytes !== null) {
      return cloneBytes(this.#bodyBytes);
    }

    if (!this.#multipartBody) {
      return null;
    }

    return new Uint8Array(await this.#multipartBody.clone().arrayBuffer());
  }

  async _getBodyBytesForDispatch(): Promise<Uint8Array | undefined> {
    return (await this._cloneBodyBytes()) ?? undefined;
  }

  _markBodyUsed(): void {
    if (this.#bodyBytes !== null || this.#multipartBody !== null) {
      this.#bodyUsed = true;
    }
  }

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
