import type { BrowserProfile, HeaderTuple, HttpMethod, RequestTimings } from './shared';

export interface NativeDnsOptions {
  servers?: string[];
  hosts?: Record<string, string[]>;
}

export interface NativeLocalAddresses {
  ipv4?: string;
  ipv6?: string;
}

export interface NativeTlsIdentityPem {
  cert: Buffer;
  key: Buffer;
}

export interface NativeTlsIdentityPfx {
  pfx: Buffer;
  passphrase?: string;
}

export type NativeTlsIdentity = NativeTlsIdentityPem | NativeTlsIdentityPfx;

export interface NativeCertificateAuthority {
  certs: Buffer[];
  includeDefaultRoots: boolean;
}

export interface NativeTlsDebug {
  peerCertificates?: boolean;
  keylogFromEnv?: boolean;
  keylogPath?: string;
}

export interface NativeTlsDanger {
  certVerification?: boolean;
  verifyHostname?: boolean;
  sni?: boolean;
}

export interface NativeTlsPeerInfo {
  peerCertificate?: Buffer;
  peerCertificateChain?: Buffer[];
}

export interface NativeRequestOptions {
  url: string;
  method: HttpMethod;
  headers: HeaderTuple[];
  origHeaders?: string[];
  body?: Buffer;
  browser?: BrowserProfile;
  emulationJson?: string;
  proxy?: string;
  disableSystemProxy?: boolean;
  dns?: NativeDnsOptions;
  timeout?: number;
  readTimeout?: number;
  connectTimeout?: number;
  disableDefaultHeaders?: boolean;
  compress?: boolean;
  http1Only?: boolean;
  http2Only?: boolean;
  localAddress?: string;
  localAddresses?: NativeLocalAddresses;
  interface?: string;
  tlsIdentity?: NativeTlsIdentity;
  ca?: NativeCertificateAuthority;
  tlsDebug?: NativeTlsDebug;
  tlsDanger?: NativeTlsDanger;
}

export interface NativeResponse {
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  body?: string;
  bodyHandle?: number;
  cookies: Record<string, string>;
  setCookies?: string[];
  timings?: RequestTimings;
  tls?: NativeTlsPeerInfo;
  url: string;
}
