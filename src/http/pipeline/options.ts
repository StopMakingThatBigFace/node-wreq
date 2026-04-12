import { serializeEmulationOptions } from '../../config/emulation';
import { Headers } from '../../headers';
import { normalizeMethod, validateBrowserProfile } from '../../native';
import type {
  NativeRequestOptions,
  ResolvedOptions,
  ResolvedRetryOptions,
  WreqInit,
} from '../../types';
import { Request } from '../request';

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

export function resolveRetryOptions(retry?: WreqInit['retry']): ResolvedRetryOptions {
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

export function resolveOptions(init: WreqInit): ResolvedOptions {
  return {
    ...init,
    headers: new Headers(init.headers),
    retry: resolveRetryOptions(init.retry),
    redirect: init.redirect ?? 'follow',
    maxRedirects: init.maxRedirects ?? 20,
    throwHttpErrors: init.throwHttpErrors ?? false,
    disableDefaultHeaders: init.disableDefaultHeaders ?? false,
    compress: init.compress ?? true,
    keepOriginalHeaderNames: init.keepOriginalHeaderNames ?? false,
  };
}

export function createRequest(urlInput: string | URL, options: ResolvedOptions): Request {
  validateBrowserProfile(options.browser);

  return new Request(resolveUrl(urlInput, options.baseURL, options.query), {
    method: normalizeMethod(options.method),
    headers: options.headers,
    body: options.body,
    signal: options.signal ?? undefined,
  });
}

export function buildNativeRequest(
  request: Request,
  options: ResolvedOptions
): NativeRequestOptions {
  return {
    url: request.url,
    method: normalizeMethod(request.method),
    headers: request.headers.toTuples(),
    origHeaders: options.keepOriginalHeaderNames ? request.headers.toOriginalNames() : undefined,
    body: request._getBodyTextForDispatch(),
    browser: options.browser,
    emulationJson: serializeEmulationOptions(options),
    proxy: options.proxy,
    timeout: options.timeout,
    disableDefaultHeaders: options.disableDefaultHeaders,
    compress: options.compress,
  };
}
