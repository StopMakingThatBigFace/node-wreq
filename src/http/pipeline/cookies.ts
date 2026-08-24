import type { CookieJar } from '../../types';
import { Headers } from '../../headers';
import { Request } from '../request';
import { Response } from '../response';

export function toCookieOriginUrl(url: string): string {
  const cookieUrl = new URL(url);

  if (cookieUrl.protocol === 'ws:') {
    cookieUrl.protocol = 'http:';
  } else if (cookieUrl.protocol === 'wss:') {
    cookieUrl.protocol = 'https:';
  }

  return cookieUrl.href;
}

export async function loadCookiesIntoRequest(
  cookieJar: CookieJar | undefined,
  request: Request
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

export async function loadCookiesIntoHeaders(
  cookieJar: CookieJar | undefined,
  url: string,
  headers: Headers
): Promise<void> {
  if (!cookieJar || headers.has('cookie')) {
    return;
  }

  const cookies = await cookieJar.getCookies(toCookieOriginUrl(url));

  if (cookies.length === 0) {
    return;
  }

  headers.set('cookie', cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '));
}

export async function persistResponseCookies(
  cookieJar: CookieJar | undefined,
  requestUrl: string,
  response: Response
): Promise<void> {
  if (!cookieJar) {
    return;
  }

  if (response.wreq.setCookies.length > 0) {
    for (const cookie of response.wreq.setCookies) {
      await cookieJar.setCookie(cookie, requestUrl);
    }

    return;
  }

  for (const [name, value] of Object.entries(response.wreq.cookies)) {
    await cookieJar.setCookie(`${name}=${value}`, requestUrl);
  }
}
