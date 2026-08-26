import assert from 'node:assert';
import { describe, test } from 'node:test';
import { createClient, fetch } from '../node-wreq';
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

  test('should release intermediate response bodies before following redirects', async () => {
    const client = createClient({
      baseURL: getBaseUrl(),
      poolMaxSize: 1,
      timeout: 1_000,
    });

    try {
      const response = await client.get('/redirect/start');

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.redirected, true);
      assert.strictEqual((await response.json<{ method: string }>()).method, 'GET');
    } finally {
      client.close();
    }
  });

  test('should rewrite POST to GET on 302 redirects', async () => {
    const response = await fetch(`${getBaseUrl()}/redirect/post-start`, {
      method: 'POST',
      body: 'hello',
    });

    const body = await response.json<{ method: string }>();

    assert.strictEqual(body.method, 'GET', '302 redirect from POST should be rewritten to GET');
  });

  test('should return 300 Multiple Choices without following Location', async () => {
    const response = await fetch(`${getBaseUrl()}/redirect/multiple-choices`);

    assert.strictEqual(response.status, 300);
    assert.strictEqual(response.headers.get('location'), '/redirect/final');
    assert.strictEqual(response.redirected, false);
    assert.deepStrictEqual(response.wreq.redirectChain, []);
  });

  test('should apply response Referrer-Policy across redirects', async () => {
    const sameOriginReferrer = `${getBaseUrl()}/private/path?token=secret#fragment`;
    const crossOriginReferrer = 'https://source.example/private/path?token=secret#fragment';
    const cases = [
      { policy: 'no-referrer', referrer: sameOriginReferrer, expected: '' },
      { policy: 'no-referrer-when-downgrade', referrer: crossOriginReferrer, expected: '' },
      {
        policy: 'same-origin',
        referrer: sameOriginReferrer,
        expected: `${getBaseUrl()}/private/path?token=secret`,
      },
      { policy: 'origin', referrer: crossOriginReferrer, expected: 'https://source.example/' },
      { policy: 'strict-origin', referrer: crossOriginReferrer, expected: '' },
      {
        policy: 'origin-when-cross-origin',
        referrer: crossOriginReferrer,
        expected: 'https://source.example/',
      },
      { policy: 'strict-origin-when-cross-origin', referrer: crossOriginReferrer, expected: '' },
      {
        policy: 'unsafe-url',
        referrer: crossOriginReferrer,
        expected: 'https://source.example/private/path?token=secret',
      },
    ];

    for (const { policy, referrer, expected } of cases) {
      const start = new URL('/redirect/start', getBaseUrl());

      start.searchParams.set('referrerPolicy', policy);

      const response = await fetch(start, {
        headers: { Referer: referrer },
      });

      const body = await response.json<{ referrer: string }>();

      assert.strictEqual(body.referrer, expected, policy);
    }
  });

  test('should strip credentials and cookies on cross-origin redirects', async () => {
    const target = new URL('/redirect/final', getBaseUrl());

    target.hostname = 'localhost';

    const start = new URL('/redirect/start', getBaseUrl());

    start.searchParams.set('target', target.toString());

    const response = await fetch(start, {
      headers: {
        authorization: 'Bearer secret',
        cookie: 'manual_session=secret',
        'proxy-authorization': 'Basic secret',
      },
    });

    const body = await response.json<{
      authorization: string;
      cookie: string;
      proxyAuthorization: string;
    }>();

    assert.strictEqual(body.authorization, '');
    assert.strictEqual(body.cookie, '');
    assert.strictEqual(body.proxyAuthorization, '');
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
