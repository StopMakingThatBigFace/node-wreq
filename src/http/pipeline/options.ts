import { Buffer } from 'node:buffer';
import { serializeEmulationOptions } from '../../config/emulation';
import { normalizeDnsOptions, normalizeProxyOptions } from '../../config/network';
import { normalizeCertificateAuthority, normalizeTlsIdentity } from '../../config/tls';
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

function resolveNativeTimeout(timeout: number | undefined): Pick<NativeRequestOptions, 'timeout'> {
  if (timeout === undefined) {
    return {};
  }

  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError('timeout must be a finite non-negative number');
  }

  return { timeout: timeout === 0 ? 0 : Math.max(1, Math.ceil(timeout)) };
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

export async function buildNativeRequest(
  request: Request,
  options: ResolvedOptions
): Promise<NativeRequestOptions> {
  const { proxy, disableSystemProxy } = normalizeProxyOptions(options.proxy);
  const body = await request._getBodyBytesForDispatch();
  const timeout = resolveNativeTimeout(options.timeout);

  return {
    url: request.url,
    method: normalizeMethod(request.method),
    headers: request.headers.toTuples(),
    origHeaders: request.headers.toOriginalNames(),
    body: body ? Buffer.from(body) : undefined,
    browser: options.browser,
    emulationJson: serializeEmulationOptions(options),
    proxy,
    disableSystemProxy,
    dns: normalizeDnsOptions(options.dns),
    ...timeout,
    disableDefaultHeaders: options.disableDefaultHeaders,
    compress: options.compress,
    tlsIdentity: normalizeTlsIdentity(options.tlsIdentity),
    ca: normalizeCertificateAuthority(options.ca),
  };
}
