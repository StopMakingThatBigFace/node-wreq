import { Readable } from 'node:stream';
import type { RequestTimings, RedirectEntry, TlsPeerInfo, WreqResponseMeta } from '../types';
import type { Response } from './response';

/** Implementation backing the `response.wreq` metadata surface. */
export class ResponseMeta implements WreqResponseMeta {
  constructor(private readonly response: Response) {}

  /** Cookies parsed from the final response state. */
  get cookies(): Record<string, string> {
    return { ...this.response._cookies };
  }

  /** Raw `Set-Cookie` header values from the final response. */
  get setCookies(): string[] {
    return [...this.response._setCookies];
  }

  /** Timing metrics collected for the request. */
  get timings(): RequestTimings | undefined {
    return this.response._timings ? { ...this.response._timings } : undefined;
  }

  /** Redirect chain leading to the final response. */
  get redirectChain(): RedirectEntry[] {
    return [...this.response._redirectChain];
  }

  /** Parsed `content-length` header value when present. */
  get contentLength(): number | undefined {
    const value = this.response.headers.get('content-length');

    if (!value) {
      return undefined;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  /** TLS peer certificate information when requested. */
  get tls(): TlsPeerInfo | undefined {
    return this.response._tls
      ? {
          peerCertificate: this.response._tls.peerCertificate
            ? Buffer.from(this.response._tls.peerCertificate)
            : undefined,
          peerCertificateChain: this.response._tls.peerCertificateChain?.map((cert) =>
            Buffer.from(cert)
          ),
        }
      : undefined;
  }

  /** Converts the response body into a Node.js readable stream. */
  readable(): Readable {
    const body = this.response.clone().body;

    return body ? Readable.fromWeb(body) : Readable.from([]);
  }
}
