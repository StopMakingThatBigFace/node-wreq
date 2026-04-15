import assert from 'node:assert';
import { describe, test } from 'node:test';
import { fetch } from '../node-wreq';
import { setupLocalTestServer } from './helpers/local-server';

describe('cookies and redirects', () => {
  const { getBaseUrl } = setupLocalTestServer();

  test('should integrate cookieJar across requests', async () => {
    const jarStore = new Map<string, string>();
    const cookieJar = {
      getCookies: () =>
        [...jarStore.entries()].map(([name, value]) => ({
          name,
          value,
        })),
      setCookie: (cookie: string) => {
        const [pair] = cookie.split(';');
        const [name, value = ''] = pair.split('=');

        jarStore.set(name, value);
      },
    };

    const setResponse = await fetch(`${getBaseUrl()}/cookies/set`, {
      cookieJar,
    });

    assert.strictEqual(setResponse.status, 200, 'cookie source request should succeed');
    assert.strictEqual(
      jarStore.get('session'),
      'abc123',
      'cookieJar should persist response cookies'
    );

    const echoResponse = await fetch(`${getBaseUrl()}/cookies/echo`, {
      cookieJar,
    });

    const body = await echoResponse.json<{ cookie: string }>();

    assert.ok(
      body.cookie.includes('session=abc123'),
      'stored cookies should be sent on the next request'
    );
  });

  test('should persist multiple raw set-cookie headers through cookieJar', async () => {
    const rawCookies: string[] = [];
    const cookieJar = {
      getCookies: () =>
        rawCookies.map((cookie) => {
          const [pair] = cookie.split(';');
          const [name, value = ''] = pair.split('=');

          return { name, value };
        }),
      setCookie: (cookie: string) => {
        rawCookies.push(cookie);
      },
    };

    const response = await fetch(`${getBaseUrl()}/cookies/set-multiple`, {
      cookieJar,
    });

    assert.strictEqual(response.status, 200, 'multiple set-cookie response should succeed');
    assert.deepStrictEqual(
      rawCookies,
      ['session=abc123; Path=/', 'csrf=token123; Path=/'],
      'cookieJar should receive each raw Set-Cookie value separately'
    );

    const echoResponse = await fetch(`${getBaseUrl()}/cookies/echo`, {
      cookieJar,
    });

    const body = await echoResponse.json<{ cookie: string }>();

    assert.ok(body.cookie.includes('session=abc123'), 'first cookie should be replayed');
    assert.ok(body.cookie.includes('csrf=token123'), 'second cookie should be replayed');
  });

  test('should follow redirects manually and run beforeRedirect hooks', async () => {
    const cookieJar = {
      store: new Map<string, string>(),
      getCookies(this: { store: Map<string, string> }) {
        return [...this.store.entries()].map(([name, value]) => ({
          name,
          value,
        }));
      },
      setCookie(this: { store: Map<string, string> }, cookie: string) {
        const [pair] = cookie.split(';');
        const [name, value = ''] = pair.split('=');

        this.store.set(name, value);
      },
    };

    const response = await fetch(`${getBaseUrl()}/redirect/start`, {
      cookieJar,
      hooks: {
        beforeRedirect: [
          ({ request, redirectCount, nextUrl }) => {
            assert.strictEqual(redirectCount, 1);
            assert.strictEqual(nextUrl, `${getBaseUrl()}/redirect/final`);
            request.headers.set('X-Redirect-Hook', 'active');
          },
        ],
      },
    });

    assert.strictEqual(response.status, 200, 'redirect chain should resolve to final response');
    assert.strictEqual(response.redirected, true, 'final response should be marked redirected');
    assert.strictEqual(response.wreq.redirectChain.length, 1, 'redirect chain should be recorded');

    const body = await response.json<{
      method: string;
      cookie: string;
      hookHeader: string;
    }>();

    assert.strictEqual(body.method, 'GET', 'GET redirect should preserve method');
    assert.ok(
      body.cookie.includes('redirect_session=1'),
      'intermediate set-cookie should affect the next redirect hop'
    );
    assert.strictEqual(
      body.hookHeader,
      'active',
      'beforeRedirect should be able to mutate next request'
    );
  });

  test('should rewrite POST to GET on 302 redirects', async () => {
    const response = await fetch(`${getBaseUrl()}/redirect/post-start`, {
      method: 'POST',
      body: 'hello',
    });

    const body = await response.json<{ method: string }>();

    assert.strictEqual(body.method, 'GET', '302 redirect from POST should be rewritten to GET');
  });

  test('should support manual redirect mode', async () => {
    const response = await fetch(`${getBaseUrl()}/redirect/start`, {
      redirect: 'manual',
    });

    assert.strictEqual(
      response.status,
      302,
      'manual redirect mode should return the redirect response'
    );
    assert.strictEqual(
      response.headers.get('location'),
      '/redirect/final',
      'manual redirect mode should expose Location'
    );
    assert.strictEqual(
      response.redirected,
      false,
      'manual redirect response should not be marked redirected'
    );
  });

  test('should support redirect error mode', async () => {
    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/redirect/start`, {
          redirect: 'error',
        });
      },
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('Redirect encountered') &&
        'code' in (error as object),
      'redirect error mode should throw on first redirect response'
    );
  });

  test('should reject when maxRedirects is exceeded', async () => {
    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/redirect/chain?count=2`, {
          maxRedirects: 1,
        });
      },
      (error: unknown) =>
        error instanceof Error &&
        'code' in (error as object) &&
        (error as { code?: unknown }).code === 'ERR_TOO_MANY_REDIRECTS'
    );
  });

  test('should reject redirect loops', async () => {
    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/redirect/loop-a`);
      },
      (error: unknown) =>
        error instanceof Error &&
        'code' in (error as object) &&
        (error as { code?: unknown }).code === 'ERR_REDIRECT_LOOP'
    );
  });
});
