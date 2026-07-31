import type { HttpMethod, RedirectEntry } from '../../types';
import { RequestError } from '../../errors';
import { Headers } from '../../headers';
import { normalizeMethod } from '../../native/index';
import { Response } from '../response';

const REDIRECT_STATUS_CODES = new Set([300, 301, 302, 303, 307, 308]);

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
  }
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
