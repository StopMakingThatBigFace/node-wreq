import type { Headers } from '../headers';
import type { Request as WreqRequest } from '../http/request';
import type { Response } from '../http/response';
import type { Hooks, HookState } from './hooks';
import type {
  BodyInit,
  BrowserProfile,
  CertificateAuthority,
  CookieJar,
  DnsOptions,
  HeadersInit,
  Http1Options,
  Http2Options,
  TlsIdentity,
  HttpMethod,
  RequestTimings,
  TlsOptions,
} from './shared';

export type RequestInput = string | URL | WreqRequest | globalThis.Request;

export interface RetryDecisionContext {
  request: WreqRequest;
  options: ResolvedOptions;
  attempt: number;
  state: HookState;
  error?: unknown;
  response?: Response;
}

export interface RetryOptions {
  limit?: number;
  methods?: HttpMethod[];
  statusCodes?: number[];
  errorCodes?: string[];
  backoff?: (ctx: RetryDecisionContext) => number | Promise<number>;
  shouldRetry?: (ctx: RetryDecisionContext) => boolean | Promise<boolean>;
}

export type RedirectMode = 'follow' | 'manual' | 'error';

export interface RedirectEntry {
  fromUrl: string;
  status: number;
  location: string;
  toUrl: string;
  method: HttpMethod;
}

export interface RequestStats {
  request: WreqRequest;
  attempt: number;
  timings: RequestTimings;
  response?: Response;
  error?: Error;
}

export interface WreqInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal | null;
  baseURL?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  browser?: BrowserProfile;
  proxy?: string | false;
  dns?: DnsOptions;
  timeout?: number;
  retry?: number | RetryOptions;
  redirect?: RedirectMode;
  maxRedirects?: number;
  cookieJar?: CookieJar;
  throwHttpErrors?: boolean;
  validateStatus?: (status: number) => boolean;
  disableDefaultHeaders?: boolean;
  compress?: boolean;
  tlsOptions?: TlsOptions;
  tlsIdentity?: TlsIdentity;
  ca?: CertificateAuthority;
  http1Options?: Http1Options;
  http2Options?: Http2Options;
  onStats?: (stats: RequestStats) => void | Promise<void>;
  context?: Record<string, unknown>;
  hooks?: Hooks;
}

export interface ResolvedRetryOptions {
  limit: number;
  methods: HttpMethod[];
  statusCodes: number[];
  errorCodes: string[];
  backoff?: RetryOptions['backoff'];
  shouldRetry?: RetryOptions['shouldRetry'];
}

export interface ResolvedOptions extends Omit<
  WreqInit,
  | 'headers'
  | 'retry'
  | 'throwHttpErrors'
  | 'disableDefaultHeaders'
  | 'compress'
  | 'redirect'
  | 'maxRedirects'
> {
  headers: Headers;
  retry: ResolvedRetryOptions;
  throwHttpErrors: boolean;
  disableDefaultHeaders: boolean;
  compress: boolean;
  redirect: RedirectMode;
  maxRedirects: number;
}

export interface WreqResponseMeta {
  readonly cookies: Record<string, string>;
  readonly setCookies: string[];
  readonly timings?: RequestTimings;
  readonly redirectChain: RedirectEntry[];
  readonly contentLength?: number;
  readable(): import('node:stream').Readable;
}
