import type { Request as WreqRequest } from '../http/request';
import type { Response } from '../http/response';
import type { RedirectEntry, RequestInput, ResolvedOptions, WreqInit } from './http';
import type { HttpMethod } from './shared';

/** Mutable state bag shared across hook executions for a single request. */
export interface HookState {
  /** Arbitrary user-defined state keyed by string. */
  [key: string]: unknown;
}

/** Context passed to `init` hooks before options are resolved. */
export interface InitContext {
  /** Original request input passed to `fetch` or a client method. */
  input: RequestInput;
  /** Mutable request options before normalization. */
  options: WreqInit;
  /** Mutable shared hook state for the request lifecycle. */
  state: HookState;
}

/** Shared context available to hooks after request normalization. */
export interface BaseHookContext {
  /** Request instance for the current attempt. */
  request: WreqRequest;
  /** Fully resolved options used for dispatch. */
  options: ResolvedOptions;
  /** Attempt number currently being processed. */
  attempt: number;
  /** Mutable shared hook state for the request lifecycle. */
  state: HookState;
}

/** Context for hooks that run before a request attempt is dispatched. */
export interface BeforeRequestContext extends BaseHookContext {}

/** Context for hooks that run after a response is received. */
export interface AfterResponseContext extends BaseHookContext {
  /** Response produced by the current attempt. */
  response: Response;
}

/** Context for hooks that run before a retry delay is applied. */
export interface BeforeRetryContext extends BaseHookContext {
  /** Error that caused the retry path to be entered. */
  error: unknown;
  /** Response associated with the retry, when available. */
  response?: Response;
}

/** Context for hooks that can rewrite the final request error. */
export interface BeforeErrorContext extends BaseHookContext {
  /** Error that is about to be thrown. */
  error: Error;
}

/** Context for hooks that run before following a redirect. */
export interface BeforeRedirectContext extends BaseHookContext {
  /** Redirect response that triggered the next request. */
  response: Response;
  /** Redirect count after including the upcoming hop. */
  redirectCount: number;
  /** Fully resolved target URL for the next request. */
  nextUrl: string;
  /** HTTP method that will be used for the next request. */
  nextMethod: HttpMethod;
  /** Redirect chain including the upcoming hop. */
  redirectChain: RedirectEntry[];
}

/** Lifecycle hooks supported by the request pipeline. */
export interface Hooks {
  /** Runs once before options are normalized. */
  init?: InitHook[];
  /** Runs before each request attempt is dispatched. */
  beforeRequest?: BeforeRequestHook[];
  /** Runs after a response is received and before retry/redirect handling. */
  afterResponse?: AfterResponseHook[];
  /** Runs before waiting for the next retry attempt. */
  beforeRetry?: BeforeRetryHook[];
  /** Runs before the final error is thrown to the caller. */
  beforeError?: BeforeErrorHook[];
  /** Runs before an automatic redirect is followed. */
  beforeRedirect?: BeforeRedirectHook[];
}

/** Hook invoked before request options are normalized. */
export type InitHook = (ctx: InitContext) => void | Promise<void>;
/** Hook invoked before each request attempt; can short-circuit with a response. */
export type BeforeRequestHook = (
  ctx: BeforeRequestContext
) => void | Response | Promise<void | Response>;
/** Hook invoked after each response; can replace the response. */
export type AfterResponseHook = (
  ctx: AfterResponseContext
) => void | Response | Promise<void | Response>;
/** Hook invoked before a retry delay is applied. */
export type BeforeRetryHook = (ctx: BeforeRetryContext) => void | Promise<void>;
/** Hook invoked before the final error is thrown; can replace the error. */
export type BeforeErrorHook = (ctx: BeforeErrorContext) => Error | void | Promise<Error | void>;
/** Hook invoked before following an automatic redirect. */
export type BeforeRedirectHook = (ctx: BeforeRedirectContext) => void | Promise<void>;
