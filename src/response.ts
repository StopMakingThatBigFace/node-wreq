import { Buffer } from 'node:buffer';
import { Headers } from './headers';
import type { NativeResponse } from './types';

export class Response {
  readonly status: number;
  readonly ok: boolean;
  readonly url: string;
  readonly headers: Headers;
  readonly cookies: Record<string, string>;
  private readonly payload: string;

  constructor(nativeResponse: NativeResponse) {
    this.status = nativeResponse.status;
    this.ok = this.status >= 200 && this.status < 300;
    this.url = nativeResponse.url;
    this.headers = new Headers(nativeResponse.headers);
    this.cookies = { ...nativeResponse.cookies };
    this.payload = nativeResponse.body;
  }

  get body(): string {
    return this.payload;
  }

  async text(): Promise<string> {
    return this.payload;
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(this.payload) as T;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const buffer = Buffer.from(this.payload, 'utf8');

    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
}
