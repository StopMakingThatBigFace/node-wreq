import type { Buffer } from 'node:buffer';

export type { BrowserProfile } from '../config/generated/browser-profiles';

/** Supported HTTP methods. */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS'
  | (string & {});

/** A single `[name, value]` HTTP header pair. */
export type HeaderTuple = [string, string];

/** Binary input accepted by TLS-related options. */
export type TlsBinaryInput = Buffer | ArrayBuffer | ArrayBufferView;

/** Text or binary input accepted by TLS-related options. */
export type TlsDataInput = string | TlsBinaryInput;

/** Header input accepted by `fetch`, `Request`, and `WebSocket` helpers. */
export type HeadersInit =
  | Record<string, string | number | boolean | null | undefined>
  | HeaderTuple[]
  | Iterable<HeaderTuple>;

/** Request and response body input supported by the library. */
export type BodyInit = string | URLSearchParams | FormData | Buffer | ArrayBuffer | ArrayBufferView;

/** DNS overrides applied by the native transport. */
export interface DnsOptions {
  /** Upstream DNS servers used for hostname resolution. */
  servers?: string | string[];
  /** Static host-to-address mappings that bypass normal DNS lookups. */
  hosts?: Record<string, string | string[]>;
}

/** Local source addresses used when opening outbound sockets. */
export interface LocalAddresses {
  /** IPv4 source address used for outbound connections. */
  ipv4?: string;
  /** IPv6 source address used for outbound connections. */
  ipv6?: string;
}

/** ALPN protocols advertised during the TLS handshake. */
export type AlpnProtocol = 'HTTP1' | 'HTTP2' | 'HTTP3';

/** ALPS protocols advertised during the TLS handshake. */
export type AlpsProtocol = 'HTTP1' | 'HTTP2' | 'HTTP3';

/** Minimum or maximum TLS version accepted by the connection. */
export type TlsVersion = '1.0' | '1.1' | '1.2' | '1.3' | 'TLS1.0' | 'TLS1.1' | 'TLS1.2' | 'TLS1.3';

/** HTTP/2 pseudo-header identifiers that can be ordered explicitly. */
export type Http2PseudoHeaderId = 'Method' | 'Scheme' | 'Authority' | 'Path' | 'Protocol';

/** HTTP/2 setting identifiers that can be ordered explicitly. */
export type Http2SettingId =
  | 'HeaderTableSize'
  | 'EnablePush'
  | 'MaxConcurrentStreams'
  | 'InitialWindowSize'
  | 'MaxFrameSize'
  | 'MaxHeaderListSize'
  | 'EnableConnectProtocol'
  | 'NoRfc7540Priorities';

/** Dependency information used for HTTP/2 prioritization. */
export interface Http2StreamDependency {
  /** Stream id that the current stream depends on. */
  dependencyId: number;
  /** Relative priority weight in the range expected by the native transport. */
  weight: number;
  /** Whether the dependency should become exclusive. */
  exclusive?: boolean;
}

/** Priority override applied to a specific HTTP/2 stream. */
export interface Http2Priority {
  /** Stream id that receives the custom priority settings. */
  streamId: number;
  /** Dependency configuration for the stream. */
  dependency: Http2StreamDependency;
}

/** Extra HTTP/2 settings passed through to the transport by raw numeric id. */
export interface Http2ExperimentalSetting {
  /** Numeric HTTP/2 setting id. */
  id: number;
  /** Value associated with the setting id. */
  value: number;
}

/** Low-level TLS fingerprinting and transport options. */
export interface TlsOptions {
  /** Ordered ALPN protocols advertised during the handshake. */
  alpnProtocols?: AlpnProtocol[];
  /** Ordered ALPS protocols advertised during the handshake. */
  alpsProtocols?: AlpsProtocol[];
  /** Enables the newer ALPS codepoint when supported by the peer. */
  alpsUseNewCodepoint?: boolean;
  /** Enables TLS session tickets. */
  sessionTicket?: boolean;
  /** Lower bound for the negotiated TLS version. */
  minTlsVersion?: TlsVersion;
  /** Upper bound for the negotiated TLS version. */
  maxTlsVersion?: TlsVersion;
  /** Enables pre-shared key support. */
  preSharedKey?: boolean;
  /** Adds ECH grease values to the ClientHello. */
  enableEchGrease?: boolean;
  /** Randomizes extension ordering where supported. */
  permuteExtensions?: boolean;
  /** Enables GREASE values in the TLS handshake. */
  greaseEnabled?: boolean;
  /** Requests OCSP stapling from the peer. */
  enableOcspStapling?: boolean;
  /** Requests signed certificate timestamps from the peer. */
  enableSignedCertTimestamps?: boolean;
  /** Advertises the TLS record size limit extension. */
  recordSizeLimit?: number;
  /** Skips session ticket usage for PSK handshakes. */
  pskSkipSessionTicket?: boolean;
  /** Limits the number of key shares sent in the handshake. */
  keySharesLimit?: number;
  /** Enables PSK with DHE key exchange. */
  pskDheKe?: boolean;
  /** Enables TLS renegotiation where supported. */
  renegotiation?: boolean;
  /** Delegated credentials value sent to the peer. */
  delegatedCredentials?: string;
  /** OpenSSL-style curve list override. */
  curvesList?: string;
  /** OpenSSL-style cipher suite list override. */
  cipherList?: string;
  /** OpenSSL-style signature algorithms list override. */
  sigalgsList?: string;
  /** Certificate compression algorithms advertised to the peer. */
  certificateCompressionAlgorithms?: Array<'zlib' | 'brotli' | 'zstd'>;
  /** Explicit TLS extension ordering permutation. */
  extensionPermutation?: number[];
  /** Forces AES hardware acceleration support on or off. */
  aesHwOverride?: boolean;
  /** Preserves the configured TLS 1.3 cipher list order. */
  preserveTls13CipherList?: boolean;
  /** Randomizes the AES hardware acceleration override. */
  randomAesHwOverride?: boolean;
}

/** Client identity loaded from PEM-encoded certificate and key material. */
export interface TlsIdentityPem {
  /** PEM certificate chain presented during mutual TLS authentication. */
  cert: TlsDataInput;
  /** PEM private key associated with `cert`. */
  key: TlsDataInput;
}

/** Client identity loaded from a PKCS#12 / PFX archive. */
export interface TlsIdentityPfx {
  /** Raw PKCS#12 / PFX archive bytes. */
  pfx: TlsBinaryInput;
  /** Passphrase used to decrypt `pfx`, when required. */
  passphrase?: string;
}

/** Client certificate identity used during mutual TLS authentication. */
export type TlsIdentity = TlsIdentityPem | TlsIdentityPfx;

/** Extra TLS diagnostics collected by the transport. */
export interface TlsDebugOptions {
  /** Includes peer certificates in response metadata. */
  peerCertificates?: boolean;
  /** Enables TLS key logging or writes it to the provided file path. */
  keylog?: true | { path: string };
}

/** Unsafe TLS toggles intended only for debugging or controlled environments. */
export interface TlsDangerOptions {
  /** Disables certificate chain verification when set to `false`. */
  certVerification?: boolean;
  /** Disables hostname verification when set to `false`. */
  verifyHostname?: boolean;
  /** Disables SNI when set to `false`. */
  sni?: boolean;
}

/** TLS peer certificate data exposed on responses. */
export interface TlsPeerInfo {
  /** Leaf certificate returned by the peer. */
  peerCertificate?: Buffer;
  /** Full peer certificate chain when available. */
  peerCertificateChain?: Buffer[];
}

/** Additional certificate authorities trusted for a request. */
export interface CertificateAuthority {
  /** One or more CA certificates in PEM or binary form. */
  cert: TlsDataInput | TlsDataInput[];
  /** Keeps the platform default trust store in addition to `cert`. */
  includeDefaultRoots?: boolean;
}

/** HTTP/1.x parser and transport tuning. */
export interface Http1Options {
  /** Allows HTTP/0.9 responses. */
  http09Responses?: boolean;
  /** Enables vectored writes when supported by the platform. */
  writev?: boolean;
  /** Maximum number of response headers accepted by the parser. */
  maxHeaders?: number;
  /** Exact read buffer size used by the HTTP/1 parser. */
  readBufExactSize?: number;
  /** Maximum HTTP/1 parser buffer size. */
  maxBufSize?: number;
  /** Ignores invalid response headers instead of failing the request. */
  ignoreInvalidHeadersInResponses?: boolean;
  /** Allows spaces after header names in response lines. */
  allowSpacesAfterHeaderNameInResponses?: boolean;
  /** Allows obsolete multiline response headers. */
  allowObsoleteMultilineHeadersInResponses?: boolean;
}

/** HTTP/2 transport tuning and fingerprinting options. */
export interface Http2Options {
  /** Enables adaptive HTTP/2 flow control windows. */
  adaptiveWindow?: boolean;
  /** Initial stream id used for locally created streams. */
  initialStreamId?: number;
  /** Initial connection-level flow control window size. */
  initialConnectionWindowSize?: number;
  /** Initial per-stream flow control window size. */
  initialWindowSize?: number;
  /** Maximum number of locally initiated streams before backpressure. */
  initialMaxSendStreams?: number;
  /** Maximum outbound HTTP/2 frame size. */
  maxFrameSize?: number;
  /** Interval for HTTP/2 keepalive pings in milliseconds. */
  keepAliveInterval?: number;
  /** Timeout waiting for a keepalive response in milliseconds. */
  keepAliveTimeout?: number;
  /** Sends keepalive pings even when no streams are active. */
  keepAliveWhileIdle?: boolean;
  /** Maximum number of concurrent reset streams tracked by the connection. */
  maxConcurrentResetStreams?: number;
  /** Maximum internal send buffer size in bytes. */
  maxSendBufferSize?: number;
  /** Maximum concurrent streams accepted from the peer. */
  maxConcurrentStreams?: number;
  /** Maximum decoded response header list size. */
  maxHeaderListSize?: number;
  /** Maximum pending accepted reset streams. */
  maxPendingAcceptResetStreams?: number;
  /** Advertises support for server push. */
  enablePush?: boolean;
  /** HTTP/2 header compression table size. */
  headerTableSize?: number;
  /** Enables the extended CONNECT protocol setting. */
  enableConnectProtocol?: boolean;
  /** Disables RFC 7540 priorities in favor of newer behavior. */
  noRfc7540Priorities?: boolean;
  /** Explicit ordering for emitted HTTP/2 settings. */
  settingsOrder?: Http2SettingId[];
  /** Explicit ordering for emitted pseudo-headers. */
  headersPseudoOrder?: Http2PseudoHeaderId[];
  /** Dependency metadata attached to the HEADERS frame. */
  headersStreamDependency?: Http2StreamDependency;
  /** Per-stream priority overrides. */
  priorities?: Http2Priority[];
  /** Additional raw numeric settings passed to the connection. */
  experimentalSettings?: Http2ExperimentalSetting[];
}

/** A single cookie entry returned by a cookie jar. */
export interface CookieJarCookie {
  /** Cookie name. */
  name: string;
  /** Cookie value. */
  value: string;
}

/** Cookie jar contract used by requests and WebSocket connections. */
export interface CookieJar {
  /** Returns cookies that should be sent for the given URL. */
  getCookies(url: string): Promise<CookieJarCookie[]> | CookieJarCookie[];
  /** Persists a single `Set-Cookie` header for the given URL. */
  setCookie(cookie: string, url: string): Promise<void> | void;
}

/** Timing information collected for a request lifecycle. */
export interface RequestTimings {
  /** Unix timestamp in milliseconds when request processing started. */
  startTime: number;
  /** Unix timestamp in milliseconds when the first response bytes arrived. */
  responseStart: number;
  /** Time in milliseconds spent waiting for the first response bytes. */
  wait: number;
  /** Unix timestamp in milliseconds when the response body finished reading. */
  endTime?: number;
  /** Total request duration in milliseconds when available. */
  total?: number;
}
