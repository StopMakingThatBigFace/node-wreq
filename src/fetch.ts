import { Buffer } from 'node:buffer';
import { AbortError, HTTPError, RequestError, TimeoutError } from './errors';
import { Headers } from './headers';
import {
  runAfterResponseHooks,
  runBeforeErrorHooks,
  runBeforeRedirectHooks,
  runBeforeRequestHooks,
  runBeforeRetryHooks,
  runInitHooks,
} from './hooks';
import { nativeRequest, normalizeMethod, validateBrowserProfile } from './native';
import { Response } from './response';
import type {
  BodyInit,
  CookieJar,
  HeadersInit,
  HttpMethod,
  NativeRequestOptions,
  NormalizedRequest,
  RedirectEntry,
  RequestInput,
  RequestLike,
  RequestStats,
  ResolvedOptions,
  ResolvedRetryOptions,
  RetryDecisionContext,
  WreqInit,
} from './types';

const DEFAULT_RETRY_METHODS = ['GET', 'HEAD'] as const;
const DEFAULT_RETRY_STATUS_CODES = [408, 425, 429, 500, 502, 503, 504];
const DEFAULT_RETRY_ERROR_CODES = [
  'ECONNABORTED',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_ABORTED',
  'ERR_TIMEOUT',
];
const REDIRECT_STATUS_CODES = new Set([300, 301, 302, 303, 307, 308]);

function isRequestLike(value: unknown): value is RequestLike {
  return typeof value === 'object' && value !== null && 'url' in value;
}

function isResponseStatusAllowed(
  status: number,
  options: Pick<ResolvedOptions, 'throwHttpErrors' | 'validateStatus'>
): boolean {
  if (options.validateStatus) {
    return options.validateStatus(status);
  }

  if (options.throwHttpErrors) {
    return status >= 200 && status < 300;
  }

  return true;
}

function appendQuery(url: URL, query: WreqInit['query']): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    url.searchParams.set(key, String(value));
  }
}

function resolveUrl(rawUrl: string | URL, baseURL?: string, query?: WreqInit['query']): string {
  const url = baseURL ? new URL(String(rawUrl), baseURL) : new URL(String(rawUrl));
  appendQuery(url, query);
  return url.toString();
}

async function normalizeBody(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === 'string') {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (Buffer.isBuffer(body)) {
    return body.toString('utf8');
  }

  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8');
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body).toString('utf8');
  }

  throw new RequestError('Unsupported body type');
}

async function mergeInputAndInit(
  input: RequestInput,
  init?: WreqInit
): Promise<{
  urlInput: string | URL;
  init: WreqInit;
}> {
  let urlInput: string | URL;
  let mergedInit: WreqInit = { ...init };

  if (typeof input === 'string' || input instanceof URL) {
    urlInput = input;
  } else if (isRequestLike(input)) {
    urlInput = input.url;
    const inputHeaders = input.headers as HeadersInit | undefined;
    const inputBody = input.body as WreqInit['body'];
    mergedInit = {
      ...init,
      method: init?.method ?? input.method,
      headers: init?.headers ?? inputHeaders,
      body: init?.body ?? inputBody,
      signal: init?.signal ?? input.signal ?? undefined,
    };

    if (mergedInit.body === undefined && typeof input.arrayBuffer === 'function') {
      if (input.bodyUsed) {
        throw new TypeError('Request body is already used');
      }

      const arrayBuffer = await input.arrayBuffer();
      mergedInit.body = arrayBuffer;
    }
  } else {
    throw new RequestError('URL is required');
  }

  return { urlInput, init: mergedInit };
}

function resolveRetryOptions(retry?: WreqInit['retry']): ResolvedRetryOptions {
  const configured = typeof retry === 'number' ? { limit: retry } : retry;

  return {
    limit: configured?.limit ?? 0,
    methods: configured?.methods ?? [...DEFAULT_RETRY_METHODS],
    statusCodes: configured?.statusCodes ?? [...DEFAULT_RETRY_STATUS_CODES],
    errorCodes: configured?.errorCodes ?? [...DEFAULT_RETRY_ERROR_CODES],
    backoff: configured?.backoff,
    shouldRetry: configured?.shouldRetry,
  };
}

function resolveOptions(init: WreqInit): ResolvedOptions {
  return {
    ...init,
    headers: new Headers(init.headers),
    retry: resolveRetryOptions(init.retry),
    redirect: init.redirect ?? 'follow',
    maxRedirects: init.maxRedirects ?? 20,
    throwHttpErrors: init.throwHttpErrors ?? false,
    disableDefaultHeaders: init.disableDefaultHeaders ?? false,
    compress: init.compress ?? true,
  };
}

function createRequest(urlInput: string | URL, options: ResolvedOptions): NormalizedRequest {
  validateBrowserProfile(options.browser);

  return {
    url: resolveUrl(urlInput, options.baseURL, options.query),
    method: normalizeMethod(options.method),
    headers: options.headers,
    body: options.body,
  };
}

function buildNativeRequest(
  request: NormalizedRequest,
  options: ResolvedOptions,
  body: string | undefined
): NativeRequestOptions {
  return {
    url: request.url,
    method: request.method,
    headers: request.headers.toObject(),
    body,
    browser: options.browser,
    proxy: options.proxy,
    timeout: options.timeout,
  };
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function isRequestError(value: unknown): value is RequestError {
  return value instanceof RequestError;
}

function normalizeRequestError(
  error: unknown,
  request: NormalizedRequest,
  attempt: number,
  response?: Response
): RequestError {
  if (error instanceof TimeoutError || error instanceof AbortError || error instanceof HTTPError) {
    error.request ??= request;
    error.response ??= response;
    error.attempt ??= attempt;
    return error;
  }

  if (isRequestError(error)) {
    error.request ??= request;
    error.response ??= response;
    error.attempt ??= attempt;
    return error;
  }

  if (isError(error)) {
    return new RequestError(error.message, {
      cause: error,
      request,
      response,
      attempt,
    });
  }

  return new RequestError(String(error), {
    cause: error,
    request,
    response,
    attempt,
  });
}

function inferErrorCode(error: unknown): string | undefined {
  if (error instanceof RequestError && error.code) {
    return error.code;
  }

  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) {
    return;
  }

  throw new AbortError(undefined, { cause: signal.reason });
}

async function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function loadCookiesIntoRequest(
  cookieJar: CookieJar | undefined,
  request: NormalizedRequest
): Promise<void> {
  if (!cookieJar || request.headers.has('cookie')) {
    return;
  }

  const cookies = await cookieJar.getCookies(request.url);
  if (cookies.length === 0) {
    return;
  }

  request.headers.set(
    'cookie',
    cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
  );
}

async function persistResponseCookies(
  cookieJar: CookieJar | undefined,
  requestUrl: string,
  response: Response
): Promise<void> {
  if (!cookieJar) {
    return;
  }

  if (response.setCookies.length > 0) {
    for (const cookie of response.setCookies) {
      await cookieJar.setCookie(cookie, requestUrl);
    }

    return;
  }

  for (const [name, value] of Object.entries(response.cookies)) {
    await cookieJar.setCookie(`${name}=${value}`, requestUrl);
  }
}

async function reportStats(
  callback: WreqInit['onStats'] | undefined,
  stats: RequestStats
): Promise<void> {
  if (!callback) {
    return;
  }

  await callback(stats);
}

async function dispatchNativeRequest(
  options: NativeRequestOptions,
  startTime: number
): Promise<Response> {
  const nativeResponse = await nativeRequest(options).catch((error: unknown) => {
    const message = String(error);
    const lowered = message.toLowerCase();

    if (lowered.includes('timed out') || lowered.includes('timeout')) {
      throw new TimeoutError(message, { cause: error });
    }

    throw new RequestError(message, { cause: error });
  });

  const responseStart = Date.now();

  return new Response({
    ...nativeResponse,
    timings: {
      startTime,
      responseStart,
      wait: responseStart - startTime,
    },
  });
}

function isRedirectResponse(response: Response): boolean {
  return REDIRECT_STATUS_CODES.has(response.status) && response.headers.has('location');
}

function resolveRedirectLocation(response: Response, requestUrl: string): string {
  const location = response.headers.get('location');
  if (!location) {
    throw new RequestError('Redirect response is missing Location header');
  }

  try {
    return new URL(location, requestUrl).toString();
  } catch (error) {
    throw new RequestError(`Invalid redirect URL: ${location}`, { cause: error });
  }
}

function stripRedirectSensitiveHeaders(
  headers: Headers,
  previousUrl: string,
  nextUrl: string,
  bodyDropped: boolean
): void {
  headers.delete('host');
  headers.delete('content-length');

  if (bodyDropped) {
    headers.delete('content-type');
  }

  if (new URL(previousUrl).origin !== new URL(nextUrl).origin) {
    headers.delete('authorization');
  }
}

function rewriteRedirectMethodAndBody(
  method: HttpMethod,
  status: number,
  body: NormalizedRequest['body']
): {
  method: HttpMethod;
  body: NormalizedRequest['body'];
  bodyDropped: boolean;
} {
  if (status === 303) {
    return {
      method: method === 'HEAD' ? 'HEAD' : 'GET',
      body: undefined,
      bodyDropped: true,
    };
  }

  if ((status === 301 || status === 302) && method === 'POST') {
    return {
      method: 'GET',
      body: undefined,
      bodyDropped: true,
    };
  }

  return {
    method,
    body,
    bodyDropped: false,
  };
}

async function shouldRetryRequest(
  context: RetryDecisionContext,
  retry: ResolvedRetryOptions
): Promise<boolean> {
  if (context.attempt > retry.limit + 1) {
    return false;
  }

  if (!retry.methods.includes(context.request.method)) {
    return false;
  }

  if (context.response) {
    if (!retry.statusCodes.includes(context.response.status)) {
      return false;
    }
  } else {
    const code = inferErrorCode(context.error);
    if (!code || !retry.errorCodes.includes(code)) {
      return false;
    }
  }

  if (!retry.shouldRetry) {
    return true;
  }

  return retry.shouldRetry(context);
}

async function runRetryDelay(
  context: RetryDecisionContext,
  retry: ResolvedRetryOptions
): Promise<void> {
  if (!retry.backoff) {
    return;
  }

  const delay = await retry.backoff(context);
  await sleep(delay);
}

function finalizeResponse(response: Response, redirectChain: RedirectEntry[]): Response {
  return response.setRedirectMetadata(redirectChain);
}

export async function fetch(input: RequestInput, init?: WreqInit): Promise<Response> {
  const merged = await mergeInputAndInit(input, init);
  const state = (merged.init.context ? { ...merged.init.context } : {}) as Record<string, unknown>;

  await runInitHooks(merged.init.hooks, {
    input,
    options: merged.init,
    state,
  });

  const options = resolveOptions(merged.init);
  const request = createRequest(merged.urlInput, options);
  const redirectChain: RedirectEntry[] = [];
  const visitedRedirectTargets = new Set<string>([request.url]);

  let attempt = 1;

  while (true) {
    const requestBody = await normalizeBody(request.body);
    const startTime = Date.now();

    try {
      throwIfAborted(options.signal);
      await loadCookiesIntoRequest(options.cookieJar, request);

      const shortCircuit = await runBeforeRequestHooks(options.hooks, {
        request,
        options,
        attempt,
        state,
      });

      let response =
        shortCircuit ??
        (await dispatchNativeRequest(buildNativeRequest(request, options, requestBody), startTime));

      if (shortCircuit) {
        response.setTimings({
          startTime,
          responseStart: startTime,
          wait: 0,
          endTime: startTime,
          total: 0,
        });
      }

      response = await runAfterResponseHooks(options.hooks, {
        request,
        options,
        attempt,
        state,
        response,
      });

      await reportStats(options.onStats, {
        request,
        attempt,
        timings: response.timings ?? {
          startTime,
          responseStart: startTime,
          wait: 0,
        },
        response,
      });

      await persistResponseCookies(options.cookieJar, request.url, response);

      if (isRedirectResponse(response)) {
        if (options.redirect === 'manual') {
          return finalizeResponse(response, redirectChain);
        }

        if (options.redirect === 'error') {
          throw new RequestError(`Redirect encountered for ${request.url}`, {
            code: 'ERR_REDIRECT',
            request,
            response,
            attempt,
          });
        }

        if (redirectChain.length >= options.maxRedirects) {
          throw new RequestError(`Maximum redirects exceeded: ${options.maxRedirects}`, {
            code: 'ERR_TOO_MANY_REDIRECTS',
            request,
            response,
            attempt,
          });
        }

        const nextUrl = resolveRedirectLocation(response, request.url);
        if (visitedRedirectTargets.has(nextUrl)) {
          throw new RequestError(`Redirect loop detected for ${nextUrl}`, {
            code: 'ERR_REDIRECT_LOOP',
            request,
            response,
            attempt,
          });
        }

        const rewritten = rewriteRedirectMethodAndBody(
          request.method,
          response.status,
          request.body
        );
        const nextRequest: NormalizedRequest = {
          url: nextUrl,
          method: rewritten.method,
          headers: request.headers,
          body: rewritten.body,
        };

        stripRedirectSensitiveHeaders(
          nextRequest.headers,
          request.url,
          nextUrl,
          rewritten.bodyDropped
        );
        if (options.cookieJar) {
          nextRequest.headers.delete('cookie');
        }

        const redirectEntry: RedirectEntry = {
          fromUrl: request.url,
          status: response.status,
          location: response.headers.get('location') ?? nextUrl,
          toUrl: nextUrl,
          method: nextRequest.method,
        };

        await runBeforeRedirectHooks(options.hooks, {
          request: nextRequest,
          options,
          attempt,
          state,
          response,
          redirectCount: redirectChain.length + 1,
          nextUrl,
          nextMethod: nextRequest.method,
          redirectChain: [...redirectChain, redirectEntry],
        });

        redirectChain.push({
          ...redirectEntry,
          toUrl: nextRequest.url,
          method: nextRequest.method,
        });
        visitedRedirectTargets.add(nextRequest.url);

        request.url = nextRequest.url;
        request.method = nextRequest.method;
        request.body = nextRequest.body;

        continue;
      }

      const nextAttempt = attempt + 1;
      const retryContext: RetryDecisionContext = {
        request,
        options,
        attempt: nextAttempt,
        state,
        response,
      };

      if (await shouldRetryRequest(retryContext, options.retry)) {
        const retryError = new HTTPError(
          `Request failed with status ${response.status}`,
          response.status,
          {
            request,
            response,
            attempt,
          }
        );

        await runBeforeRetryHooks(options.hooks, {
          request,
          options,
          attempt: nextAttempt,
          state,
          error: retryError,
          response,
        });

        await runRetryDelay({ ...retryContext, error: retryError }, options.retry);
        attempt = nextAttempt;
        continue;
      }

      if (!isResponseStatusAllowed(response.status, options)) {
        throw new HTTPError(`Request failed with status ${response.status}`, response.status, {
          request,
          response,
          attempt,
        });
      }

      return finalizeResponse(response, redirectChain);
    } catch (error: unknown) {
      const normalizedError = normalizeRequestError(error, request, attempt);
      const errorEndTime = Date.now();

      await reportStats(options.onStats, {
        request,
        attempt,
        timings: {
          startTime,
          responseStart: errorEndTime,
          wait: errorEndTime - startTime,
          endTime: errorEndTime,
          total: errorEndTime - startTime,
        },
        error: normalizedError,
        response: normalizedError.response,
      });

      const nextAttempt = attempt + 1;
      const retryContext: RetryDecisionContext = {
        request,
        options,
        attempt: nextAttempt,
        state,
        error: normalizedError,
        response: normalizedError.response,
      };

      if (await shouldRetryRequest(retryContext, options.retry)) {
        await runBeforeRetryHooks(options.hooks, {
          request,
          options,
          attempt: nextAttempt,
          state,
          error: normalizedError,
          response: normalizedError.response,
        });

        await runRetryDelay(retryContext, options.retry);
        attempt = nextAttempt;
        continue;
      }

      const finalError = await runBeforeErrorHooks(options.hooks, {
        request,
        options,
        attempt,
        state,
        error: normalizedError,
      });

      throw finalError;
    }
  }
}
