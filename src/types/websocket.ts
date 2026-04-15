import type {
  BrowserProfile,
  CertificateAuthority,
  CookieJar,
  DnsOptions,
  HeadersInit,
  Http1Options,
  Http2Options,
  TlsDangerOptions,
  TlsDebugOptions,
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
  tlsDebug?: TlsDebugOptions;
  tlsDanger?: TlsDangerOptions;
  http1Options?: Http1Options;
  http2Options?: Http2Options;
  protocols?: string | string[];
  binaryType?: WebSocketBinaryType;
  forceHttp2?: boolean;
  readBufferSize?: number;
  writeBufferSize?: number;
  maxWriteBufferSize?: number;
  acceptUnmaskedFrames?: boolean;
  maxFrameSize?: number;
  maxMessageSize?: number;
  localAddress?: string;
  localAddresses?: import('./shared').LocalAddresses;
  interface?: string;
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
  tlsDebug?: import('./native').NativeTlsDebug;
  tlsDanger?: import('./native').NativeTlsDanger;
  protocols: string[];
  forceHttp2?: boolean;
  readBufferSize?: number;
  writeBufferSize?: number;
  maxWriteBufferSize?: number;
  acceptUnmaskedFrames?: boolean;
  maxFrameSize?: number;
  maxMessageSize?: number;
  localAddress?: string;
  localAddresses?: import('./native').NativeLocalAddresses;
  interface?: string;
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
