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
  TlsDangerOptions,
  TlsDebugOptions,
  TlsOptions,
  TlsPeerInfo,
} from './shared';

/** Input accepted by the top-level `fetch` helper and client methods. */
export type RequestInput = string | URL | WreqRequest | globalThis.Request;

/** Context passed to retry callbacks. */
export interface RetryDecisionContext {
  /** Request instance being retried. */
  request: WreqRequest;
  /** Fully resolved request options for this attempt. */
  options: ResolvedOptions;
  /** Next attempt number being evaluated. */
  attempt: number;
  /** Mutable hook state shared across the request lifecycle. */
  state: HookState;
  /** Error that triggered the retry check, when available. */
  error?: unknown;
  /** Response that triggered the retry check, when available. */
  response?: Response;
}

/** Retry policy configuration. */
export interface RetryOptions {
  /** Maximum number of additional retry attempts. */
  limit?: number;
  /** HTTP methods eligible for automatic retry. */
  methods?: HttpMethod[];
  /** HTTP status codes eligible for automatic retry. */
  statusCodes?: number[];
  /** Error codes eligible for automatic retry. */
  errorCodes?: string[];
  /** Delay strategy returning milliseconds before the next retry. */
  backoff?: (ctx: RetryDecisionContext) => number | Promise<number>;
  /** Predicate deciding whether the request should be retried. */
  shouldRetry?: (ctx: RetryDecisionContext) => boolean | Promise<boolean>;
}

/** Redirect handling mode used by requests. */
export type RedirectMode = 'follow' | 'manual' | 'error';

/** A single redirect hop recorded for the response metadata. */
export interface RedirectEntry {
  /** Original URL before the redirect. */
  fromUrl: string;
  /** HTTP status code returned by the redirect response. */
  status: number;
  /** Redirect target taken from the `Location` header. */
  location: string;
  /** Final resolved URL used for the next request. */
  toUrl: string;
  /** HTTP method used for the redirected request. */
  method: HttpMethod;
}

/** Request statistics delivered through the `onStats` callback. */
export interface RequestStats {
  /** Request instance associated with this attempt. */
  request: WreqRequest;
  /** Attempt number that produced this stats payload. */
  attempt: number;
  /** Timing metrics for the attempt. */
  timings: RequestTimings;
  /** Response received for the attempt, when available. */
  response?: Response;
  /** Error raised for the attempt, when available. */
  error?: Error;
}

/** Request options accepted by `fetch`, `Request`, and client helpers. */
export interface WreqInit {
  /** HTTP method used for the request. */
  method?: string;
  /** Request headers. */
  headers?: HeadersInit;
  /** Request body payload. */
  body?: BodyInit | null;
  /** Abort signal controlling request cancellation. */
  signal?: AbortSignal | null;
  /** Base URL resolved against relative request inputs. */
  baseURL?: string;
  /** Query parameters appended to the final request URL. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Browser fingerprint profile used by the native transport. */
  browser?: BrowserProfile;
  /** Explicit proxy URL, or `false` to disable proxies entirely. */
  proxy?: string | false;
  /** DNS overrides used for hostname resolution. */
  dns?: DnsOptions;
  /** Total request timeout in milliseconds. */
  timeout?: number;
  /** Read timeout in milliseconds while receiving the response body. */
  readTimeout?: number;
  /** Connection establishment timeout in milliseconds. */
  connectTimeout?: number;
  /** Retry policy or retry count. */
  retry?: number | RetryOptions;
  /** Redirect handling mode. */
  redirect?: RedirectMode;
  /** Maximum number of redirects followed automatically. */
  maxRedirects?: number;
  /** Cookie jar used to read and persist cookies. */
  cookieJar?: CookieJar;
  /** Throws `HTTPError` for disallowed status codes when `true`. */
  throwHttpErrors?: boolean;
  /** Custom predicate deciding which status codes are considered successful. */
  validateStatus?: (status: number) => boolean;
  /** Disables headers that the library normally injects automatically. */
  disableDefaultHeaders?: boolean;
  /** Enables transparent compression handling where supported. */
  compress?: boolean;
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
  /** Forces the request to use HTTP/1.x only. */
  http1Only?: boolean;
  /** Forces the request to use HTTP/2 only. */
  http2Only?: boolean;
  /** Local source address used for the outbound socket. */
  localAddress?: string;
  /** Per-family local source addresses used for the outbound socket. */
  localAddresses?: import('./shared').LocalAddresses;
  /** Network interface name used for the outbound socket. */
  interface?: string;
  /** HTTP/1.x parser and transport tuning. */
  http1Options?: Http1Options;
  /** HTTP/2 transport tuning and fingerprinting options. */
  http2Options?: Http2Options;
  /** Callback invoked after each attempt with timing and outcome data. */
  onStats?: (stats: RequestStats) => void | Promise<void>;
  /** Mutable user-defined context copied into hook state. */
  context?: Record<string, unknown>;
  /** Lifecycle hooks executed around the request. */
  hooks?: Hooks;
}

/** Retry policy after numeric shorthands and defaults are resolved. */
export interface ResolvedRetryOptions {
  /** Maximum number of additional retry attempts. */
  limit: number;
  /** HTTP methods eligible for retry. */
  methods: HttpMethod[];
  /** HTTP status codes eligible for retry. */
  statusCodes: number[];
  /** Error codes eligible for retry. */
  errorCodes: string[];
  /** Delay strategy returning milliseconds before the next retry. */
  backoff?: RetryOptions['backoff'];
  /** Predicate deciding whether the request should be retried. */
  shouldRetry?: RetryOptions['shouldRetry'];
}

/** Fully normalized request options used internally during dispatch. */
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
  /** Normalized request headers. */
  headers: Headers;
  /** Resolved retry policy. */
  retry: ResolvedRetryOptions;
  /** Whether disallowed status codes raise `HTTPError`. */
  throwHttpErrors: boolean;
  /** Whether automatic headers are disabled. */
  disableDefaultHeaders: boolean;
  /** Whether automatic compression support is enabled. */
  compress: boolean;
  /** Redirect handling mode. */
  redirect: RedirectMode;
  /** Maximum number of redirects followed automatically. */
  maxRedirects: number;
}

/** Extra response metadata exposed under `response.wreq`. */
export interface WreqResponseMeta {
  /** Cookies parsed from the final `Set-Cookie` state. */
  readonly cookies: Record<string, string>;
  /** Raw `Set-Cookie` header values received on the final response. */
  readonly setCookies: string[];
  /** Request timing metrics when available. */
  readonly timings?: RequestTimings;
  /** Redirect chain leading to the final response. */
  readonly redirectChain: RedirectEntry[];
  /** Parsed `content-length` header value when present. */
  readonly contentLength?: number;
  /** TLS peer certificate information when requested. */
  readonly tls?: TlsPeerInfo;
  /** Converts the response body into a Node.js readable stream. */
  readable(): import('node:stream').Readable;
}
