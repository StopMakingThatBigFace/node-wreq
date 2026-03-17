import { Buffer } from 'node:buffer';
import { HTTPError, RequestError } from './errors';
import { Headers } from './headers';
import {
  runAfterResponseHooks,
  runBeforeErrorHooks,
  runBeforeRequestHooks,
  runInitHooks,
} from './hooks';
import { nativeRequest, normalizeMethod, validateBrowserProfile } from './native';
import { Response } from './response';
import type {
  HeadersInit,
  NativeRequestOptions,
  NormalizedRequest,
  RequestInput,
  RequestLike,
  ResolvedOptions,
  WreqInit,
} from './types';

function isRequestLike(value: unknown): value is RequestLike {
  return typeof value === 'object' && value !== null && 'url' in value;
}

function isResponseStatusAllowed(
  status: number,
  options: Pick<WreqInit, 'throwHttpErrors' | 'validateStatus'>,
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

async function normalizeBody(body: WreqInit['body']): Promise<string | undefined> {
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
  init?: WreqInit,
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

async function normalizeInput(
  urlInput: string | URL,
  init: WreqInit,
): Promise<{
  nativeRequest: NativeRequestOptions;
  request: NormalizedRequest;
  options: ResolvedOptions;
}> {
  if (init.cookieJar) {
    throw new RequestError('cookieJar support is not implemented yet');
  }

  const method = normalizeMethod(init.method);
  validateBrowserProfile(init.browser);

  const headers = new Headers(init.headers);
  const request: NormalizedRequest = {
    url: resolveUrl(urlInput, init.baseURL, init.query),
    method,
    headers,
    body: init.body,
  };

  const options: ResolvedOptions = {
    ...init,
    headers,
  };

  const nativeRequest: NativeRequestOptions = {
    url: request.url,
    method: request.method,
    headers: request.headers.toObject(),
    body: await normalizeBody(request.body),
    browser: init.browser,
    proxy: init.proxy,
    timeout: init.timeout,
  };

  return { nativeRequest, request, options };
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function normalizeRequestError(error: unknown): Error {
  if (isError(error)) {
    return error;
  }

  return new RequestError(String(error), { cause: error });
}

async function dispatchNativeRequest(options: NativeRequestOptions): Promise<Response> {
  const nativeResponse = await nativeRequest(options).catch((error: unknown) => {
    const message = String(error);
    if (message.toLowerCase().includes('timed out')) {
      throw new RequestError(message, { code: 'ERR_TIMEOUT', cause: error });
    }
    throw new RequestError(message, { cause: error });
  });

  return new Response(nativeResponse);
}

export async function fetch(input: RequestInput, init?: WreqInit): Promise<Response> {
  const state = (init?.context ? { ...init.context } : {}) as Record<string, unknown>;
  const merged = await mergeInputAndInit(input, init);
  await runInitHooks(merged.init.hooks, {
    input,
    options: merged.init,
    state,
  });

  const { nativeRequest, options, request } = await normalizeInput(merged.urlInput, merged.init);

  try {
    const shortCircuit = await runBeforeRequestHooks(options.hooks, {
      request,
      options,
      attempt: 1,
      state,
    });

    let response =
      shortCircuit ??
      (await dispatchNativeRequest({
        ...nativeRequest,
        url: request.url,
        method: request.method,
        headers: request.headers.toObject(),
        body: await normalizeBody(request.body),
        proxy: options.proxy,
        browser: options.browser,
        timeout: options.timeout,
      }));

    response = await runAfterResponseHooks(options.hooks, {
      request,
      options,
      attempt: 1,
      state,
      response,
    });

    if (!isResponseStatusAllowed(response.status, options)) {
      throw new HTTPError(`Request failed with status ${response.status}`, response.status);
    }

    return response;
  } catch (error: unknown) {
    const normalizedError = await runBeforeErrorHooks(options.hooks, {
      request,
      options,
      attempt: 1,
      state,
      error: normalizeRequestError(error),
    });
    throw normalizedError;
  }
}
