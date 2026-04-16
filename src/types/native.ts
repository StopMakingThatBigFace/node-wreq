import type { BrowserProfile, HeaderTuple, HttpMethod, RequestTimings } from './shared';

/** Normalized DNS overrides passed to the native layer. */
export interface NativeDnsOptions {
  /** Upstream DNS servers used for hostname resolution. */
  servers?: string[];
  /** Static host-to-address mappings that bypass normal DNS lookups. */
  hosts?: Record<string, string[]>;
}

/** Normalized local source addresses passed to the native layer. */
export interface NativeLocalAddresses {
  /** IPv4 source address used for outbound connections. */
  ipv4?: string;
  /** IPv6 source address used for outbound connections. */
  ipv6?: string;
}

/** PEM-based client identity converted to raw buffers for the native layer. */
export interface NativeTlsIdentityPem {
  /** PEM certificate chain presented during mutual TLS authentication. */
  cert: Buffer;
  /** PEM private key associated with `cert`. */
  key: Buffer;
}

/** PKCS#12 / PFX client identity converted to raw buffers for the native layer. */
export interface NativeTlsIdentityPfx {
  /** Raw PKCS#12 / PFX archive bytes. */
  pfx: Buffer;
  /** Passphrase used to decrypt `pfx`, when required. */
  passphrase?: string;
}

/** Client certificate identity passed to the native layer. */
export type NativeTlsIdentity = NativeTlsIdentityPem | NativeTlsIdentityPfx;

/** Trusted certificate authorities passed to the native layer. */
export interface NativeCertificateAuthority {
  /** CA certificate chain converted to buffers. */
  certs: Buffer[];
  /** Keeps the platform default trust store in addition to `certs`. */
  includeDefaultRoots: boolean;
}

/** TLS debug toggles passed to the native layer. */
export interface NativeTlsDebug {
  /** Includes peer certificates in response metadata. */
  peerCertificates?: boolean;
  /** Reads TLS key log configuration from the environment. */
  keylogFromEnv?: boolean;
  /** Writes TLS key material to the provided file path. */
  keylogPath?: string;
}

/** Unsafe TLS toggles passed to the native layer. */
export interface NativeTlsDanger {
  /** Disables certificate chain verification when set to `false`. */
  certVerification?: boolean;
  /** Disables hostname verification when set to `false`. */
  verifyHostname?: boolean;
  /** Disables SNI when set to `false`. */
  sni?: boolean;
}

/** TLS peer certificate data returned from the native layer. */
export interface NativeTlsPeerInfo {
  /** Leaf certificate returned by the peer. */
  peerCertificate?: Buffer;
  /** Full peer certificate chain when available. */
  peerCertificateChain?: Buffer[];
}

/** Fully normalized native request payload. */
export interface NativeRequestOptions {
  /** Fully resolved request URL. */
  url: string;
  /** Normalized HTTP method. */
  method: HttpMethod;
  /** Normalized request headers. */
  headers: HeaderTuple[];
  /** Original-case header names preserved for the native layer. */
  origHeaders?: string[];
  /** Encoded request body bytes. */
  body?: Buffer;
  /** Browser fingerprint profile used by the native transport. */
  browser?: BrowserProfile;
  /** Serialized emulation options passed to the native layer. */
  emulationJson?: string;
  /** Proxy URL used for the request. */
  proxy?: string;
  /** Prevents fallback to system proxy settings when `true`. */
  disableSystemProxy?: boolean;
  /** DNS overrides used by the native transport. */
  dns?: NativeDnsOptions;
  /** Total request timeout in milliseconds. */
  timeout?: number;
  /** Read timeout in milliseconds while receiving the response body. */
  readTimeout?: number;
  /** Connection establishment timeout in milliseconds. */
  connectTimeout?: number;
  /** Disables headers normally injected by the library. */
  disableDefaultHeaders?: boolean;
  /** Enables transparent compression handling where supported. */
  compress?: boolean;
  /** Forces the request to use HTTP/1.x only. */
  http1Only?: boolean;
  /** Forces the request to use HTTP/2 only. */
  http2Only?: boolean;
  /** Local source address used for the outbound socket. */
  localAddress?: string;
  /** Per-family local source addresses used for the outbound socket. */
  localAddresses?: NativeLocalAddresses;
  /** Network interface name used for the outbound socket. */
  interface?: string;
  /** Client certificate identity used for mTLS. */
  tlsIdentity?: NativeTlsIdentity;
  /** Additional trusted certificate authorities. */
  ca?: NativeCertificateAuthority;
  /** TLS diagnostic options. */
  tlsDebug?: NativeTlsDebug;
  /** Unsafe TLS toggles intended only for controlled environments. */
  tlsDanger?: NativeTlsDanger;
}

/** Raw response payload returned by the native layer. */
export interface NativeResponse {
  /** HTTP status code. */
  status: number;
  /** HTTP reason phrase when provided by the transport. */
  statusText?: string;
  /** Response headers normalized to a plain object. */
  headers: Record<string, string>;
  /** Eagerly loaded UTF-8 response body, when available. */
  body?: string;
  /** Native body handle used for streaming large responses. */
  bodyHandle?: number;
  /** Final cookie state after processing `Set-Cookie` headers. */
  cookies: Record<string, string>;
  /** Raw `Set-Cookie` header values received on the response. */
  setCookies?: string[];
  /** Request timing metrics when available. */
  timings?: RequestTimings;
  /** TLS peer certificate information when requested. */
  tls?: NativeTlsPeerInfo;
  /** Final response URL. */
  url: string;
}
