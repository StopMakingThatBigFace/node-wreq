import type { BrowserProfile, HeaderTuple, HttpMethod, RequestTimings } from './shared';

export interface NativeDnsOptions {
  servers?: string[];
  hosts?: Record<string, string[]>;
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
  disableDefaultHeaders?: boolean;
  compress?: boolean;
  tlsIdentity?: NativeTlsIdentity;
  ca?: NativeCertificateAuthority;
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
  url: string;
}
