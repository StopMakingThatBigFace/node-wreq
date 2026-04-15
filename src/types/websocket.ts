import type {
  BrowserProfile,
  CertificateAuthority,
  CookieJar,
  DnsOptions,
  HeadersInit,
  Http1Options,
  Http2Options,
  TlsIdentity,
  TlsOptions,
} from './shared';
import type { HeaderTuple } from './shared';

export type WebSocketBinaryType = 'blob' | 'arraybuffer';

export interface WebSocketInit {
  headers?: HeadersInit;
  baseURL?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  browser?: BrowserProfile;
  proxy?: string | false;
  dns?: DnsOptions;
  timeout?: number;
  cookieJar?: CookieJar;
  disableDefaultHeaders?: boolean;
  tlsOptions?: TlsOptions;
  tlsIdentity?: TlsIdentity;
  ca?: CertificateAuthority;
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
  disableSystemProxy?: boolean;
  dns?: import('./native').NativeDnsOptions;
  timeout?: number;
  disableDefaultHeaders?: boolean;
  tlsIdentity?: import('./native').NativeTlsIdentity;
  ca?: import('./native').NativeCertificateAuthority;
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
