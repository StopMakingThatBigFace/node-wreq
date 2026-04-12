import { Readable } from 'node:stream';
import type { RequestTimings, RedirectEntry, WreqResponseMeta } from '../types';
import type { Response } from './response';

export class ResponseMeta implements WreqResponseMeta {
  constructor(private readonly response: Response) {}

  get cookies(): Record<string, string> {
    return { ...this.response._cookies };
  }

  get setCookies(): string[] {
    return [...this.response._setCookies];
  }

  get timings(): RequestTimings | undefined {
    return this.response._timings ? { ...this.response._timings } : undefined;
  }

  get redirectChain(): RedirectEntry[] {
    return [...this.response._redirectChain];
  }

  get contentLength(): number | undefined {
    const value = this.response.headers.get('content-length');

    if (!value) {
      return undefined;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  readable(): Readable {
    const body = this.response.clone().body;

    return body ? Readable.fromWeb(body) : Readable.from([]);
  }
}
