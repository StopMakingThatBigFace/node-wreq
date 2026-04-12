import type { BrowserProfile, HeaderTuple, HttpMethod, RequestTimings } from './shared';

export interface NativeRequestOptions {
  url: string;
  method: HttpMethod;
  headers: HeaderTuple[];
  origHeaders?: string[];
  body?: string;
  browser?: BrowserProfile;
  emulationJson?: string;
  proxy?: string;
  timeout?: number;
  disableDefaultHeaders?: boolean;
  compress?: boolean;
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
