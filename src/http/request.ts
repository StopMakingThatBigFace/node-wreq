import { Blob, Buffer } from 'node:buffer';
import { ReadableStream } from 'node:stream/web';
import { Headers } from '../headers';
import type { BodyInit, HeadersInit, WreqInit } from '../types';
import { cloneBytes, toBodyBytes } from './body/bytes';

export class Request {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly signal: AbortSignal | null;
  #bodyBytes: Uint8Array | null;
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
      this.#bodyBytes =
        init.body !== undefined
          ? toBodyBytes(init.body, 'Unsupported request body type')
          : cloneBytes(input.#bodyBytes);

      return;
    }

    this.url = String(init.baseURL ? new URL(String(input), init.baseURL) : input);
    this.method = (init.method ?? 'GET').toUpperCase();
    this.headers = new Headers(init.headers);
    this.signal = init.signal ?? null;
    this.#bodyBytes = toBodyBytes(init.body, 'Unsupported request body type');
  }

  get body(): ReadableStream<Uint8Array> | null {
    if (this.#bodyUsed || this.#bodyBytes === null) {
      return null;
    }

    this.#bodyUsed = true;
    this.#stream ??= new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(cloneBytes(this.#bodyBytes)!);
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

    return cloned;
  }

  async text(): Promise<string> {
    return Buffer.from(this.#consumeBytes()).toString('utf8');
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return Uint8Array.from(this.#consumeBytes()).buffer;
  }

  async blob(): Promise<Blob> {
    return new Blob([this.#consumeBytes()]);
  }

  async formData(): Promise<FormData> {
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

  _cloneBodyBytes(): Uint8Array | null {
    return cloneBytes(this.#bodyBytes);
  }

  _getBodyTextForDispatch(): string | undefined {
    if (this.#bodyBytes === null) {
      return undefined;
    }

    return Buffer.from(this.#bodyBytes).toString('utf8');
  }

  _markBodyUsed(): void {
    if (this.#bodyBytes !== null) {
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
    }

    return next;
  }

  #consumeBytes(): Uint8Array {
    if (this.#bodyUsed) {
      throw new TypeError('Request body is already used');
    }

    this.#bodyUsed = true;

    return cloneBytes(this.#bodyBytes) ?? new Uint8Array();
  }
}

export function isWreqRequest(value: unknown): value is Request {
  return value instanceof Request;
}
