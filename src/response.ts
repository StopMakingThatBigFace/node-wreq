import { Blob, Buffer } from 'node:buffer';
import { ReadableStream } from 'node:stream/web';
import { Headers } from './headers';
import { nativeCancelBody, nativeReadBodyAll, nativeReadBodyChunk } from './native';
import type { NativeResponse, RedirectEntry, RequestTimings } from './types';

export class Response {
  readonly status: number;
  readonly ok: boolean;
  readonly url: string;
  readonly headers: Headers;
  readonly cookies: Record<string, string>;
  readonly setCookies: string[];
  timings?: RequestTimings;
  redirected: boolean;
  redirectChain: RedirectEntry[];
  bodyUsed: boolean;
  private payload: string | null;
  private payloadBytes: Uint8Array | null;
  private bodyHandle: number | null;
  private stream: ReadableStream<Uint8Array> | null;

  constructor(nativeResponse: NativeResponse) {
    this.status = nativeResponse.status;
    this.ok = this.status >= 200 && this.status < 300;
    this.url = nativeResponse.url;
    this.headers = new Headers(nativeResponse.headers);
    this.cookies = { ...nativeResponse.cookies };
    this.setCookies = [...(nativeResponse.setCookies ?? [])];
    this.timings = nativeResponse.timings ? { ...nativeResponse.timings } : undefined;
    this.redirected = false;
    this.redirectChain = [];
    this.payload = nativeResponse.body ?? null;
    this.payloadBytes = nativeResponse.body ? Buffer.from(nativeResponse.body, 'utf8') : null;
    this.bodyHandle = nativeResponse.bodyHandle ?? null;
    this.bodyUsed = false;
    this.stream = null;
  }

  setRedirectMetadata(chain: RedirectEntry[]): this {
    this.redirected = chain.length > 0;
    this.redirectChain = [...chain];
    return this;
  }

  setTimings(timings: RequestTimings): this {
    this.timings = { ...timings };
    return this;
  }

  private markBodyComplete(): void {
    if (!this.timings || this.timings.endTime !== undefined) {
      return;
    }

    const endTime = Date.now();
    this.timings = {
      ...this.timings,
      endTime,
      total: endTime - this.timings.startTime,
    };
  }

  get body(): ReadableStream<Uint8Array> | null {
    if (this.bodyUsed) {
      return null;
    }

    this.bodyUsed = true;

    if (this.payloadBytes) {
      this.stream ??= new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(new Uint8Array(this.payloadBytes!));
          controller.close();
        },
      });

      return this.stream;
    }

    if (this.bodyHandle === null) {
      return null;
    }

    const handle = this.bodyHandle;
    this.stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const result = await nativeReadBodyChunk(handle);
        if (result.chunk.length > 0) {
          controller.enqueue(new Uint8Array(result.chunk));
        }

        if (result.done) {
          this.bodyHandle = null;
          this.markBodyComplete();
          controller.close();
        }
      },
      cancel: async () => {
        this.bodyHandle = null;
        nativeCancelBody(handle);
        this.markBodyComplete();
      },
    });

    return this.stream;
  }

  get bodyText(): string {
    if (this.payload === null) {
      throw new TypeError('Response body text is not available synchronously');
    }

    return this.payload;
  }

  private async consumeBytes(): Promise<Uint8Array> {
    if (this.bodyUsed) {
      throw new TypeError('Response body is already used');
    }

    this.bodyUsed = true;

    if (this.payloadBytes) {
      this.markBodyComplete();
      return new Uint8Array(this.payloadBytes);
    }

    if (this.bodyHandle === null) {
      this.markBodyComplete();
      return new Uint8Array();
    }

    const bytes = await nativeReadBodyAll(this.bodyHandle);
    this.bodyHandle = null;
    this.payloadBytes = new Uint8Array(bytes);
    this.payload = Buffer.from(this.payloadBytes).toString('utf8');
    this.markBodyComplete();
    return new Uint8Array(this.payloadBytes);
  }

  private getContentType(): string {
    return this.headers.get('content-type')?.toLowerCase() ?? '';
  }

  async text(): Promise<string> {
    return Buffer.from(await this.consumeBytes()).toString('utf8');
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const buffer = Buffer.from(await this.consumeBytes());

    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  async blob(): Promise<Blob> {
    return new Blob([await this.consumeBytes()]);
  }

  async formData(): Promise<FormData> {
    const contentType = this.getContentType();

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = new FormData();
      const searchParams = new URLSearchParams(await this.text());

      for (const [name, value] of searchParams) {
        formData.append(name, value);
      }

      return formData;
    }

    if (contentType.includes('multipart/form-data')) {
      throw new TypeError('multipart/form-data parsing is not implemented yet');
    }

    throw new TypeError(`Response content-type is not form data: ${contentType || 'unknown'}`);
  }

  clone(): Response {
    if (this.bodyUsed) {
      throw new TypeError('Response body is already used');
    }

    if (!this.payloadBytes || this.payload === null) {
      throw new TypeError('Cannot clone a native streaming response before it is buffered');
    }

    const cloned = new Response({
      status: this.status,
      headers: this.headers.toObject(),
      body: this.payload,
      cookies: this.cookies,
      setCookies: this.setCookies,
      timings: this.timings,
      url: this.url,
    });

    return cloned.setRedirectMetadata(this.redirectChain);
  }
}
