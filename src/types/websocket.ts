import type {
  BrowserProfile,
  CookieJar,
  HeadersInit,
  Http1Options,
  Http2Options,
  TlsOptions,
} from './shared';
import type { HeaderTuple } from './shared';

export type WebSocketBinaryType = 'blob' | 'arraybuffer';

export interface WebSocketInit {
  headers?: HeadersInit;
  keepOriginalHeaderNames?: boolean;
  baseURL?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  browser?: BrowserProfile;
  proxy?: string;
  timeout?: number;
  cookieJar?: CookieJar;
  disableDefaultHeaders?: boolean;
  tlsOptions?: TlsOptions;
  http1Options?: Http1Options;
  http2Options?: Http2Options;
  protocols?: string | string[];
  binaryType?: WebSocketBinaryType;
}

export interface NativeWebSocketConnectOptions {
  url: string;
  headers: HeaderTuple[];
  origHeaders?: string[];
  browser?: BrowserProfile;
  emulationJson?: string;
  proxy?: string;
  timeout?: number;
  disableDefaultHeaders?: boolean;
  protocols: string[];
}

export interface NativeWebSocketConnection {
  handle: number;
  url: string;
  protocol: string | null;
  extensions: string | null;
}

export type NativeWebSocketReadResult =
  | {
      type: 'text';
      data: string;
    }
  | {
      type: 'binary';
      data: Uint8Array;
    }
  | {
      type: 'close';
      code: number;
      reason: string;
      wasClean: boolean;
    };
