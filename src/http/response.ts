import { Blob, Buffer } from 'node:buffer';
import { STATUS_CODES } from 'node:http';
import { ReadableStream } from 'node:stream/web';
import { TextDecoder } from 'node:util';
import { Headers } from '../headers';
import { nativeCancelBody, nativeReadBodyChunk } from '../native';
import type {
  BodyInit,
  HeadersInit,
  NativeResponse,
  RedirectEntry,
  RequestTimings,
  WreqResponseMeta,
} from '../types';
import { cloneBytes, toBodyBytes } from './body/bytes';
import { parseResponseFormData } from './body/form-data';
import { ResponseMeta } from './response-meta';

type ResponseInitWithUrl = ResponseInit & {
  url?: string;
};

function resolveCharset(contentType: string | null): string {
  if (!contentType) {
    return 'utf-8';
  }

  const match = contentType.match(/charset\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  const label = (match?.[1] ?? match?.[2] ?? 'utf-8').trim();

  return label || 'utf-8';
}

function decodeText(bytes: Uint8Array, contentType: string | null): string {
  const charset = resolveCharset(contentType);

  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function toHeadersInit(headers: ResponseInit['headers'] | undefined): HeadersInit | undefined {
  if (headers === undefined) {
    return undefined;
  }

  if (headers instanceof Headers) {
    return new Headers(headers);
  }

  if (typeof globalThis.Headers !== 'undefined' && headers instanceof globalThis.Headers) {
    return new Headers(Array.from(headers.entries()));
  }

  return headers as unknown as HeadersInit;
}

function isNativeResponse(value: unknown): value is NativeResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'headers' in value &&
    'url' in value
  );
}

export class Response {
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly url: string;
  readonly headers: Headers;
  readonly type = 'basic' as const;
  readonly wreq: WreqResponseMeta;
  _cookies: Record<string, string>;
  _setCookies: string[];
  _timings?: RequestTimings;
  _redirectChain: RedirectEntry[];
  redirected: boolean;
  #payloadBytes: Uint8Array | null;
  #bodyHandle: number | null;
  #bodyUsed: boolean;
  #streamSource: ReadableStream<Uint8Array> | null;
  #stream: ReadableStream<Uint8Array> | null;
  #orphanedStreamReaders: ReadableStreamDefaultReader<Uint8Array>[];

  constructor(body?: BodyInit | NativeResponse | null, init: ResponseInitWithUrl = {}) {
    if (isNativeResponse(body)) {
      this.status = body.status;
      this.statusText = body.statusText ?? STATUS_CODES[body.status] ?? '';
      this.url = body.url;
      this.headers = new Headers(body.headers);
      this._cookies = { ...body.cookies };
      this._setCookies = [...(body.setCookies ?? [])];
      this._timings = body.timings ? { ...body.timings } : undefined;
      this._redirectChain = [];
      this.redirected = false;
      this.#payloadBytes = body.body !== undefined ? Buffer.from(body.body, 'utf8') : null;
      this.#bodyHandle = body.bodyHandle ?? null;
      this.#stream = null;
    } else {
      this.status = init.status ?? 200;
      this.statusText = init.statusText ?? STATUS_CODES[this.status] ?? '';
      this.url = init.url ?? '';
      this.headers = new Headers(toHeadersInit(init.headers));
      this._cookies = {};
      this._setCookies = [];
      this._timings = undefined;
      this._redirectChain = [];
      this.redirected = false;
      this.#payloadBytes = toBodyBytes(body ?? null, 'Unsupported response body type');
      this.#bodyHandle = null;
      this.#stream = null;
    }

    this.ok = this.status >= 200 && this.status < 300;
    this.#bodyUsed = false;
    this.#streamSource = null;
    this.wreq = new ResponseMeta(this);
    this.#orphanedStreamReaders = [];
  }

  get bodyUsed(): boolean {
    return this.#bodyUsed;
  }

  setRedirectMetadata(chain: RedirectEntry[]): this {
    this.redirected = chain.length > 0;
    this._redirectChain = [...chain];

    return this;
  }

  setTimings(timings: RequestTimings): this {
    this._timings = { ...timings };

    return this;
  }

  get body(): ReadableStream<Uint8Array> | null {
    return this.#ensureStream();
  }

  async text(): Promise<string> {
    return decodeText(await this.#consumeBytes(), this.headers.get('content-type'));
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
    const contentType = this.headers.get('content-type') ?? '';

    return parseResponseFormData(await this.#consumeBytes(), contentType);
  }

  clone(): Response {
    if (this.#isBodyUnusable()) {
      throw new TypeError('Response.clone: Body has already been consumed.');
    }

    const cloned = new Response(null, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers.toObject(),
      url: this.url,
    });

    cloned._cookies = { ...this._cookies };
    cloned._setCookies = [...this._setCookies];
    cloned._timings = this._timings ? { ...this._timings } : undefined;
    cloned._redirectChain = [...this._redirectChain];
    cloned.redirected = this.redirected;

    const source = this.#ensureStreamSource();

    if (source) {
      const previousStream = this.#stream;
      const [left, right] = source.tee();

      this.#streamSource = left;
      this.#stream = null;
      cloned.#streamSource = right;
      if (previousStream) {
        this.#orphanedStreamReaders.push(previousStream.getReader());
      }

      return cloned;
    }

    if (this.#payloadBytes !== null) {
      cloned.#payloadBytes = cloneBytes(this.#payloadBytes);

      return cloned;
    }

    return cloned;
  }

  #isBodyUnusable(): boolean {
    return this.#bodyUsed || this.#stream?.locked === true;
  }

  #ensureStreamSource(): ReadableStream<Uint8Array> | null {
    if (this.#streamSource) {
      return this.#streamSource;
    }

    if (this.#payloadBytes !== null) {
      const bytes = cloneBytes(this.#payloadBytes)!;
      let emitted = false;

      this.#streamSource = new ReadableStream<Uint8Array>({
        pull: (controller) => {
          if (!emitted) {
            emitted = true;
            controller.enqueue(bytes);
          }

          controller.close();
        },
      });

      return this.#streamSource;
    }

    if (this.#bodyHandle === null) {
      return null;
    }

    const handle = this.#bodyHandle;

    this.#bodyHandle = null;
    this.#streamSource = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const result = await nativeReadBodyChunk(handle);

        if (result.chunk.length > 0) {
          controller.enqueue(new Uint8Array(result.chunk));
        }

        if (result.done) {
          controller.close();
        }
      },
      cancel: async () => {
        nativeCancelBody(handle);
      },
    });

    return this.#streamSource;
  }

  #markBodyComplete(): void {
    if (!this._timings || this._timings.endTime !== undefined) {
      return;
    }

    const endTime = Date.now();

    this._timings = {
      ...this._timings,
      endTime,
      total: endTime - this._timings.startTime,
    };
  }

  #ensureStream(): ReadableStream<Uint8Array> | null {
    if (this.#stream) {
      return this.#stream;
    }

    const source = this.#ensureStreamSource();

    if (!source) {
      return null;
    }

    let sourceReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    this.#stream = new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          this.#bodyUsed = true;
          sourceReader ??= source.getReader();
          const result = await sourceReader.read();

          if (result.done) {
            this.#markBodyComplete();
            controller.close();

            return;
          }

          controller.enqueue(result.value);
        },
        cancel: async () => {
          this.#bodyUsed = true;
          if (sourceReader) {
            await sourceReader.cancel();
          } else {
            await source.cancel();
          }

          this.#markBodyComplete();
        },
      },
      { highWaterMark: 0 }
    );

    return this.#stream;
  }

  async #consumeBytes(): Promise<Uint8Array> {
    if (this.#isBodyUnusable()) {
      throw new TypeError('Body is unusable: Body has already been read');
    }

    const stream = this.#ensureStream();

    if (stream) {
      this.#bodyUsed = true;
      const reader = stream.getReader();

      this.#orphanedStreamReaders.push(reader);
      const chunks: Uint8Array[] = [];

      while (true) {
        const result = await reader.read();

        if (result.done) {
          break;
        }

        chunks.push(result.value);
      }

      const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));

      this.#payloadBytes = new Uint8Array(merged);

      return new Uint8Array(this.#payloadBytes);
    }

    const bytes = this.#payloadBytes;

    return bytes === null ? new Uint8Array() : new Uint8Array(bytes);
  }
}
