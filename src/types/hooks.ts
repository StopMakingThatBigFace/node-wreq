import type { Request as WreqRequest } from '../http/request';
import type { Response } from '../http/response';
import type { RedirectEntry, RequestInput, ResolvedOptions, WreqInit } from './http';
import type { HttpMethod } from './shared';

export interface HookState {
  [key: string]: unknown;
}

export interface InitContext {
  input: RequestInput;
  options: WreqInit;
  state: HookState;
}

export interface BaseHookContext {
  request: WreqRequest;
  options: ResolvedOptions;
  attempt: number;
  state: HookState;
}

export interface BeforeRequestContext extends BaseHookContext {}

export interface AfterResponseContext extends BaseHookContext {
  response: Response;
}

export interface BeforeRetryContext extends BaseHookContext {
  error: unknown;
  response?: Response;
}

export interface BeforeErrorContext extends BaseHookContext {
  error: Error;
}

export interface BeforeRedirectContext extends BaseHookContext {
  response: Response;
  redirectCount: number;
  nextUrl: string;
  nextMethod: HttpMethod;
  redirectChain: RedirectEntry[];
}

export interface Hooks {
  init?: InitHook[];
  beforeRequest?: BeforeRequestHook[];
  afterResponse?: AfterResponseHook[];
  beforeRetry?: BeforeRetryHook[];
  beforeError?: BeforeErrorHook[];
  beforeRedirect?: BeforeRedirectHook[];
}

export type InitHook = (ctx: InitContext) => void | Promise<void>;
export type BeforeRequestHook = (
  ctx: BeforeRequestContext
) => void | Response | Promise<void | Response>;
export type AfterResponseHook = (
  ctx: AfterResponseContext
) => void | Response | Promise<void | Response>;
export type BeforeRetryHook = (ctx: BeforeRetryContext) => void | Promise<void>;
export type BeforeErrorHook = (ctx: BeforeErrorContext) => Error | void | Promise<Error | void>;
export type BeforeRedirectHook = (ctx: BeforeRedirectContext) => void | Promise<void>;
