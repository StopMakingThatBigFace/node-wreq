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

/** Binary payload representation used by incoming WebSocket messages. */
export type WebSocketBinaryType = 'blob' | 'arraybuffer';

/** Options accepted by the WebSocket constructor and helper. */
export interface WebSocketInit {
  /** Request headers sent during the WebSocket handshake. */
  headers?: HeadersInit;
  /** Base URL resolved against relative WebSocket URLs. */
  baseURL?: string;
  /** Query parameters appended to the final WebSocket URL. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Browser fingerprint profile used by the native transport. */
  browser?: BrowserProfile;
  /** Explicit proxy URL, or `false` to disable proxies entirely. */
  proxy?: string | false;
  /** DNS overrides used for hostname resolution. */
  dns?: DnsOptions;
  /** Handshake timeout in milliseconds. */
  timeout?: number;
  /** Cookie jar used to populate the handshake request. */
  cookieJar?: CookieJar;
  /** Disables headers normally injected by the library. */
  disableDefaultHeaders?: boolean;
  /** Low-level TLS fingerprinting and transport options. */
  tlsOptions?: TlsOptions;
  /** Client certificate identity used for mTLS. */
  tlsIdentity?: TlsIdentity;
  /** Additional trusted certificate authorities. */
  ca?: CertificateAuthority;
  /** TLS diagnostic options. */
  tlsDebug?: TlsDebugOptions;
  /** Unsafe TLS toggles intended only for controlled environments. */
  tlsDanger?: TlsDangerOptions;
  /** HTTP/1.x parser and transport tuning. */
  http1Options?: Http1Options;
  /** HTTP/2 transport tuning and fingerprinting options. */
  http2Options?: Http2Options;
  /** Requested subprotocol or ordered subprotocol list. */
  protocols?: string | string[];
  /** Binary representation used for incoming binary messages. */
  binaryType?: WebSocketBinaryType;
  /** Forces the handshake to use HTTP/2 where supported. */
  forceHttp2?: boolean;
  /** Read buffer size used by the native socket implementation. */
  readBufferSize?: number;
  /** Write buffer size used by the native socket implementation. */
  writeBufferSize?: number;
  /** Maximum buffered outbound bytes before backpressure. */
  maxWriteBufferSize?: number;
  /** Allows unmasked frames from the peer. */
  acceptUnmaskedFrames?: boolean;
  /** Maximum accepted WebSocket frame size in bytes. */
  maxFrameSize?: number;
  /** Maximum accepted WebSocket message size in bytes. */
  maxMessageSize?: number;
  /** Local source address used for the outbound socket. */
  localAddress?: string;
  /** Per-family local source addresses used for the outbound socket. */
  localAddresses?: import('./shared').LocalAddresses;
  /** Network interface name used for the outbound socket. */
  interface?: string;
}

/** Normalized native WebSocket connection options. */
export interface NativeWebSocketConnectOptions {
  /** Fully resolved WebSocket URL. */
  url: string;
  /** Normalized handshake headers. */
  headers: HeaderTuple[];
  /** Original-case header names preserved for the native layer. */
  origHeaders?: string[];
  /** Browser fingerprint profile used by the native transport. */
  browser?: BrowserProfile;
  /** Serialized emulation options passed to the native layer. */
  emulationJson?: string;
  /** Proxy URL used for the connection. */
  proxy?: string;
  /** Prevents fallback to system proxy settings when `true`. */
  disableSystemProxy?: boolean;
  /** DNS overrides used by the native transport. */
  dns?: import('./native').NativeDnsOptions;
  /** Handshake timeout in milliseconds. */
  timeout?: number;
  /** Disables headers normally injected by the library. */
  disableDefaultHeaders?: boolean;
  /** Client certificate identity used for mTLS. */
  tlsIdentity?: import('./native').NativeTlsIdentity;
  /** Additional trusted certificate authorities. */
  ca?: import('./native').NativeCertificateAuthority;
  /** TLS diagnostic options. */
  tlsDebug?: import('./native').NativeTlsDebug;
  /** Unsafe TLS toggles intended only for controlled environments. */
  tlsDanger?: import('./native').NativeTlsDanger;
  /** Ordered list of requested subprotocols. */
  protocols: string[];
  /** Forces the handshake to use HTTP/2 where supported. */
  forceHttp2?: boolean;
  /** Read buffer size used by the native socket implementation. */
  readBufferSize?: number;
  /** Write buffer size used by the native socket implementation. */
  writeBufferSize?: number;
  /** Maximum buffered outbound bytes before backpressure. */
  maxWriteBufferSize?: number;
  /** Allows unmasked frames from the peer. */
  acceptUnmaskedFrames?: boolean;
  /** Maximum accepted WebSocket frame size in bytes. */
  maxFrameSize?: number;
  /** Maximum accepted WebSocket message size in bytes. */
  maxMessageSize?: number;
  /** Local source address used for the outbound socket. */
  localAddress?: string;
  /** Per-family local source addresses used for the outbound socket. */
  localAddresses?: import('./native').NativeLocalAddresses;
  /** Network interface name used for the outbound socket. */
  interface?: string;
}

/** Native connection information returned after a successful WebSocket handshake. */
export interface NativeWebSocketConnection {
  /** Native handle used for subsequent socket operations. */
  handle: number;
  /** Final connected WebSocket URL. */
  url: string;
  /** Negotiated subprotocol, if any. */
  protocol: string | null;
  /** Negotiated extensions string, if any. */
  extensions: string | null;
}

export type NativeWebSocketReadResult =
  | {
      /** Message type returned by the native layer. */
      type: 'text';
      /** UTF-8 text payload. */
      data: string;
    }
  | {
      /** Message type returned by the native layer. */
      type: 'binary';
      /** Binary payload bytes. */
      data: Uint8Array;
    }
  | {
      /** Message type returned by the native layer. */
      type: 'close';
      /** Close code sent by the peer or native layer. */
      code: number;
      /** Close reason string sent by the peer. */
      reason: string;
      /** Whether the close handshake completed cleanly. */
      wasClean: boolean;
    };
