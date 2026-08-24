import type { HttpMethod, RedirectEntry } from '../../types';
import { RequestError } from '../../errors';
import { Headers } from '../../headers';
import { normalizeMethod } from '../../native/index';
import { Response } from '../response';

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const REFERRER_POLICIES = new Set<RedirectReferrerPolicy>([
  'no-referrer',
  'no-referrer-when-downgrade',
  'same-origin',
  'origin',
  'strict-origin',
  'origin-when-cross-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

export type RedirectReferrerPolicy = Exclude<globalThis.Request['referrerPolicy'], ''>;

export const DEFAULT_REDIRECT_REFERRER_POLICY: RedirectReferrerPolicy =
  'strict-origin-when-cross-origin';

export function isRedirectResponse(response: Response): boolean {
  return REDIRECT_STATUS_CODES.has(response.status) && response.headers.has('location');
}

export function resolveRedirectLocation(response: Response, requestUrl: string): string {
  const location = response.headers.get('location');

  if (!location) {
    throw new RequestError('Redirect response is missing Location header');
  }

  try {
    return new URL(location, requestUrl).toString();
  } catch (error) {
    throw new RequestError(`Invalid redirect URL: ${location}`, {
      cause: error,
    });
  }
}

export function stripRedirectSensitiveHeaders(
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
    headers.delete('cookie');
    headers.delete('cookie2');
    headers.delete('proxy-authorization');
  }
}

function responseReferrerPolicy(response: Response): RedirectReferrerPolicy | undefined {
  const value = response.headers.get('referrer-policy');

  if (!value) {
    return undefined;
  }

  let policy: RedirectReferrerPolicy | undefined;

  for (const token of value.split(',')) {
    const normalized = token.trim().toLowerCase() as RedirectReferrerPolicy;

    if (REFERRER_POLICIES.has(normalized)) {
      policy = normalized;
    }
  }

  return policy;
}

function parseReferrer(headers: Headers): URL | undefined {
  const value = headers.get('referer');

  if (!value) {
    return undefined;
  }

  let referrer: URL;

  try {
    referrer = new URL(value);
  } catch {
    headers.delete('referer');

    return undefined;
  }

  if (referrer.protocol !== 'http:' && referrer.protocol !== 'https:') {
    headers.delete('referer');

    return undefined;
  }

  referrer.username = '';
  referrer.password = '';
  referrer.hash = '';

  if (referrer.toString().length > 4096) {
    referrer.pathname = '/';
    referrer.search = '';
  }

  return referrer;
}

export function applyRedirectReferrerPolicy(
  headers: Headers,
  response: Response,
  nextUrl: string,
  currentPolicy: RedirectReferrerPolicy
): RedirectReferrerPolicy {
  const policy = responseReferrerPolicy(response) ?? currentPolicy;
  const referrer = parseReferrer(headers);

  if (!referrer) {
    return policy;
  }

  const destination = new URL(nextUrl);
  const sameOrigin = referrer.origin === destination.origin;
  const downgrade = referrer.protocol === 'https:' && destination.protocol === 'http:';
  let stripToOrigin = false;

  switch (policy) {
    case 'no-referrer':
      headers.delete('referer');

      return policy;

    case 'no-referrer-when-downgrade':
      if (downgrade) {
        headers.delete('referer');

        return policy;
      }

      break;

    case 'same-origin':
      if (!sameOrigin) {
        headers.delete('referer');

        return policy;
      }

      break;

    case 'origin':
      stripToOrigin = true;
      break;

    case 'strict-origin':
      if (downgrade) {
        headers.delete('referer');

        return policy;
      }

      stripToOrigin = true;
      break;

    case 'origin-when-cross-origin':
      stripToOrigin = !sameOrigin;
      break;

    case 'strict-origin-when-cross-origin':
      if (!sameOrigin && downgrade) {
        headers.delete('referer');

        return policy;
      }

      stripToOrigin = !sameOrigin;
      break;

    case 'unsafe-url':
      break;
  }

  if (stripToOrigin) {
    referrer.pathname = '/';
    referrer.search = '';
  }

  headers.set('Referer', referrer.toString());

  return policy;
}

export function rewriteRedirectMethod(
  method: HttpMethod,
  status: number
): {
  method: HttpMethod;
  bodyDropped: boolean;
} {
  if (status === 303) {
    return {
      method: method === 'HEAD' ? 'HEAD' : 'GET',
      bodyDropped: true,
    };
  }

  if ((status === 301 || status === 302) && method === 'POST') {
    return {
      method: 'GET',
      bodyDropped: true,
    };
  }

  return {
    method,
    bodyDropped: false,
  };
}

export function finalizeResponse(response: Response, redirectChain: RedirectEntry[]): Response {
  return response.setRedirectMetadata(redirectChain);
}

export function toRedirectEntry(
  requestUrl: string,
  response: Response,
  nextUrl: string,
  nextMethod: string
): RedirectEntry {
  return {
    fromUrl: requestUrl,
    status: response.status,
    location: response.headers.get('location') ?? nextUrl,
    toUrl: nextUrl,
    method: normalizeMethod(nextMethod),
  };
}
