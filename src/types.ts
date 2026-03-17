/**
 * Browser profile names supported
 */
export type BrowserProfile =
  | 'chrome_100'
  | 'chrome_101'
  | 'chrome_104'
  | 'chrome_105'
  | 'chrome_106'
  | 'chrome_107'
  | 'chrome_108'
  | 'chrome_109'
  | 'chrome_110'
  | 'chrome_114'
  | 'chrome_116'
  | 'chrome_117'
  | 'chrome_118'
  | 'chrome_119'
  | 'chrome_120'
  | 'chrome_123'
  | 'chrome_124'
  | 'chrome_126'
  | 'chrome_127'
  | 'chrome_128'
  | 'chrome_129'
  | 'chrome_130'
  | 'chrome_131'
  | 'chrome_132'
  | 'chrome_133'
  | 'chrome_134'
  | 'chrome_135'
  | 'chrome_136'
  | 'chrome_137'
  | 'edge_101'
  | 'edge_122'
  | 'edge_127'
  | 'edge_131'
  | 'edge_134'
  | 'safari_ios_17_2'
  | 'safari_ios_17_4_1'
  | 'safari_ios_16_5'
  | 'safari_15_3'
  | 'safari_15_5'
  | 'safari_15_6_1'
  | 'safari_16'
  | 'safari_16_5'
  | 'safari_17_0'
  | 'safari_17_2_1'
  | 'safari_17_4_1'
  | 'safari_17_5'
  | 'safari_18'
  | 'safari_ipad_18'
  | 'safari_18_2'
  | 'safari_ios_18_1_1'
  | 'safari_18_3'
  | 'safari_18_3_1'
  | 'safari_18_5'
  | 'firefox_109'
  | 'firefox_117'
  | 'firefox_128'
  | 'firefox_133'
  | 'firefox_135'
  | 'firefox_private_135'
  | 'firefox_android_135'
  | 'firefox_136'
  | 'firefox_private_136'
  | 'firefox_139'
  | 'opera_116'
  | 'opera_117'
  | 'opera_118'
  | 'opera_119'
  | 'okhttp_3_9'
  | 'okhttp_3_11'
  | 'okhttp_3_13'
  | 'okhttp_3_14'
  | 'okhttp_4_9'
  | 'okhttp_4_10'
  | 'okhttp_4_12'
  | 'okhttp_5';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';

export type HeaderTuple = [string, string];

export type HeadersInit =
  | Record<string, string | number | boolean | null | undefined>
  | HeaderTuple[]
  | Iterable<HeaderTuple>;

export type BodyInit = string | URLSearchParams | Buffer | ArrayBuffer | ArrayBufferView;

export interface RequestLike {
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
  signal?: AbortSignal | null;
  bodyUsed?: boolean;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

export type RequestInput = string | URL | RequestLike;

export interface HookState {
  [key: string]: unknown;
}

export interface CookieJarCookie {
  name: string;
  value: string;
}

export interface CookieJar {
  getCookies(url: string): Promise<CookieJarCookie[]> | CookieJarCookie[];
  setCookie(cookie: string, url: string): Promise<void> | void;
}

export interface WreqInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal | null;
  baseURL?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  browser?: BrowserProfile;
  proxy?: string;
  timeout?: number;
  cookieJar?: CookieJar;
  throwHttpErrors?: boolean;
  validateStatus?: (status: number) => boolean;
  disableDefaultHeaders?: boolean;
  compress?: boolean;
  context?: Record<string, unknown>;
  hooks?: Hooks;
}

export interface NormalizedRequest {
  url: string;
  method: HttpMethod;
  headers: import('./headers').Headers;
  body?: BodyInit | null;
}

export interface ResolvedOptions extends Omit<WreqInit, 'headers'> {
  headers: import('./headers').Headers;
}

export interface InitContext {
  input: RequestInput;
  options: WreqInit;
  state: HookState;
}

export interface BaseHookContext {
  request: NormalizedRequest;
  options: ResolvedOptions;
  attempt: number;
  state: HookState;
}

export interface BeforeRequestContext extends BaseHookContext {}

export interface AfterResponseContext extends BaseHookContext {
  response: import('./response').Response;
}

export interface BeforeRetryContext extends BaseHookContext {
  error: unknown;
}

export interface BeforeErrorContext extends BaseHookContext {
  error: Error;
}

export interface Hooks {
  init?: InitHook[];
  beforeRequest?: BeforeRequestHook[];
  afterResponse?: AfterResponseHook[];
  beforeRetry?: BeforeRetryHook[];
  beforeError?: BeforeErrorHook[];
}

export type InitHook = (ctx: InitContext) => void | Promise<void>;
export type BeforeRequestHook = (
  ctx: BeforeRequestContext,
) => void | import('./response').Response | Promise<void | import('./response').Response>;
export type AfterResponseHook = (
  ctx: AfterResponseContext,
) => void | import('./response').Response | Promise<void | import('./response').Response>;
export type BeforeRetryHook = (ctx: BeforeRetryContext) => void | Promise<void>;
export type BeforeErrorHook = (ctx: BeforeErrorContext) => Error | void | Promise<Error | void>;

export interface NativeRequestOptions {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  browser?: BrowserProfile;
  proxy?: string;
  timeout?: number;
}

export interface NativeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  cookies: Record<string, string>;
  url: string;
}

export interface ClientDefaults extends Omit<WreqInit, 'body' | 'method' | 'signal'> {
  headers?: HeadersInit;
  hooks?: Hooks;
}

export interface Client {
  readonly defaults: ClientDefaults;
  fetch(input: RequestInput, init?: WreqInit): Promise<import('./response').Response>;
  get(input: RequestInput, init?: Omit<WreqInit, 'method'>): Promise<import('./response').Response>;
  post(
    input: RequestInput,
    body?: BodyInit | null,
    init?: Omit<WreqInit, 'method' | 'body'>,
  ): Promise<import('./response').Response>;
  extend(defaults: ClientDefaults): Client;
}
