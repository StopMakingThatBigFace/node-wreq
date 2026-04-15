import assert from 'node:assert';
import { describe, test } from 'node:test';
import { Request as WreqRequest, createClient, fetch, getProfiles } from '../node-wreq';
import { setupLocalTestServer } from './helpers/local-server';

describe('http client', () => {
  const { getBaseUrl } = setupLocalTestServer();

  test('should return available browser profiles', () => {
    const profiles = getProfiles();

    assert.ok(Array.isArray(profiles), 'Profiles should be an array');
    assert.ok(profiles.length > 0, 'Should have at least one profile');
    assert.ok(
      profiles.includes('chrome_137') ||
        profiles.includes('firefox_139') ||
        profiles.includes('safari_18'),
      'Should include standard browser profiles'
    );
  });

  test('should make a simple GET request', async () => {
    const response = await fetch('https://httpbin.org/get', {
      browser: 'chrome_131',
      timeout: 15000,
    });

    assert.ok(response.status >= 200 && response.status < 300, 'Should return successful status');
    assert.ok(Object.keys(response.headers).length > 0, 'Should have response headers');

    const body = await response.json<{ headers: Record<string, string> }>();

    assert.ok(body.headers['User-Agent'], 'Should have User-Agent header');
  });

  test('should work with different browser profiles', async () => {
    const testUrl = 'https://httpbin.org/user-agent';
    const browsers = ['chrome_137', 'firefox_139', 'safari_18'];

    for (const browser of browsers) {
      const response = await fetch(testUrl, {
        browser: browser as any,
        timeout: 30000,
      });

      assert.ok(response.status === 200, `${browser} should return status 200`);

      const data = await response.json<Record<string, string>>();

      assert.ok(data['user-agent'], `${browser} should have user-agent`);
    }
  });

  test('should handle timeout errors', async () => {
    await assert.rejects(
      async () => {
        await fetch('https://httpbin.org/delay/10', {
          browser: 'chrome_137',
          timeout: 1000,
        });
      },
      {
        name: 'TimeoutError',
      },
      'Should throw an error on timeout'
    );
  });

  test('should disable request timeout when timeout is set to 0', async () => {
    const response = await fetch(`${getBaseUrl()}/timings/delay`, {
      browser: 'chrome_137',
      timeout: 0,
    });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { delayed: true });
  });

  test('should abort requests after dispatch has started', async () => {
    const controller = new AbortController();
    const responsePromise = fetch(`${getBaseUrl()}/timings/delay?ms=250`, {
      browser: 'chrome_137',
      timeout: 0,
      signal: controller.signal,
    });

    setTimeout(() => {
      controller.abort(new Error('stop'));
    }, 20);

    await assert.rejects(responsePromise, {
      name: 'AbortError',
      code: 'ERR_ABORTED',
    });
  });

  test('should reject invalid timeout values', async () => {
    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/headers/raw`, {
          browser: 'chrome_137',
          timeout: Number.NaN,
        });
      },
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.strictEqual(error.name, 'RequestError');
        const cause = (error as { cause?: unknown }).cause;

        assert.ok(
          cause instanceof TypeError,
          'invalid timeout should be surfaced with the original TypeError as cause'
        );

        return true;
      }
    );

    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/headers/raw`, {
          browser: 'chrome_137',
          timeout: -1,
        });
      },
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.strictEqual(error.name, 'RequestError');
        const cause = (error as { cause?: unknown }).cause;

        assert.ok(cause instanceof TypeError);

        return true;
      }
    );

    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/headers/raw`, {
          connectTimeout: Number.NaN,
        });
      },
      (error: unknown) => error instanceof Error && error.name === 'RequestError'
    );
  });

  test('should support arbitrary HTTP methods', async () => {
    const customResponse = await fetch(`${getBaseUrl()}/body/echo`, {
      method: 'PROPFIND',
    });
    const customBody = await customResponse.json<{ method: string }>();

    assert.strictEqual(customBody.method, 'PROPFIND');
  });

  test('should support client options/put/patch/delete/head helpers', async () => {
    const client = createClient({
      baseURL: getBaseUrl(),
    });

    const optionsResponse = await client.options('/body/echo');
    const putResponse = await client.put('/body/echo', 'put-body');
    const patchResponse = await client.patch('/body/echo', 'patch-body');
    const deleteResponse = await client.delete('/body/echo');
    const headResponse = await client.head('/headers/raw');

    assert.strictEqual((await optionsResponse.json<{ method: string }>()).method, 'OPTIONS');
    assert.strictEqual((await putResponse.json<{ method: string; body: string }>()).method, 'PUT');
    assert.strictEqual(
      (await patchResponse.json<{ method: string; body: string }>()).body,
      'patch-body'
    );
    assert.strictEqual((await deleteResponse.json<{ method: string }>()).method, 'DELETE');
    assert.strictEqual(headResponse.status, 200);
  });

  test('should support http1Only and reject conflicting protocol forcing', async () => {
    const response = await fetch(`${getBaseUrl()}/headers/raw`, {
      http1Only: true,
    });

    assert.strictEqual(response.status, 200);

    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/headers/raw`, {
          http1Only: true,
          http2Only: true,
        });
      },
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RequestError' &&
        (error as Error).message.includes('http1Only and http2Only cannot both be true')
    );
  });

  test('should reject invalid local bind options', async () => {
    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/headers/raw`, {
          localAddress: 'not-an-ip',
        });
      },
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RequestError' &&
        error.message.includes('localAddress must be a valid IPv4 or IPv6 address')
    );

    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/headers/raw`, {
          interface: '   ',
        });
      },
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'RequestError' &&
        error.message.includes('interface must be a non-empty string')
    );
  });

  test('should support fetch-style requests', async () => {
    const response = await fetch('https://httpbin.org/get', {
      browser: 'chrome_137',
      query: { source: 'fetch' },
      throwHttpErrors: true,
      timeout: 15000,
    });

    assert.strictEqual(response.ok, true, 'Fetch response should expose ok');

    const body = await response.json<{ args: Record<string, string> }>();

    assert.strictEqual(body.args.source, 'fetch', 'Should apply query params');
  });

  test('should support createClient defaults', async () => {
    const client = createClient({
      browser: 'chrome_137',
      baseURL: 'https://httpbin.org',
      timeout: 15000,
      headers: {
        'X-Test-Client': 'node-wreq',
      },
    });

    const response = await client.get('/headers');
    const body = await response.json<{ headers: Record<string, string> }>();

    assert.strictEqual(
      body.headers['X-Test-Client'],
      'node-wreq',
      'Client defaults should be merged into outgoing requests'
    );
  });

  test('should allow validateStatus to accept a custom non-2xx response', async () => {
    const response = await fetch(`${getBaseUrl()}/status/418`, {
      throwHttpErrors: true,
      validateStatus: (status) => status === 418,
    });

    assert.strictEqual(response.status, 418);
    assert.deepStrictEqual(await response.json(), { status: 418 });
  });

  test('should reject responses when validateStatus returns false', async () => {
    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/status/204`, {
          throwHttpErrors: false,
          validateStatus: () => false,
        });
      },
      (error: unknown) => error instanceof Error && error.name === 'HTTPError'
    );
  });

  test('should support client.post helper', async () => {
    const client = createClient({
      baseURL: getBaseUrl(),
    });

    const response = await client.post('/body/echo', JSON.stringify({ created: true }), {
      headers: {
        'content-type': 'application/json',
      },
    });
    const body = await response.json<{ method: string; body: string }>();

    assert.strictEqual(body.method, 'POST');
    assert.strictEqual(body.body, JSON.stringify({ created: true }));
  });

  test('should merge defaults through client.extend', async () => {
    let observedState: Record<string, unknown> | undefined;

    const baseClient = createClient({
      baseURL: getBaseUrl(),
      headers: {
        'x-base': 'one',
      },
      query: {
        base: '1',
      },
      context: {
        fromBase: true,
      },
      hooks: {
        beforeRequest: [
          ({ request, state }) => {
            observedState = { ...state };
            request.headers.set(
              'x-state',
              `${String(state.fromBase)}:${String(state.fromOverride)}`
            );
          },
        ],
      },
    });

    const client = baseClient.extend({
      headers: {
        'x-extended': 'two',
      },
      query: {
        extended: '2',
      },
      context: {
        fromOverride: true,
      },
    });

    const response = await client.get('/headers/raw');
    const body = await response.json<{ headers: Record<string, string> }>();
    const requestUrl = new URL(response.url);

    assert.strictEqual(body.headers['x-base'], 'one');
    assert.strictEqual(body.headers['x-extended'], 'two');
    assert.strictEqual(body.headers['x-state'], 'true:true');
    assert.strictEqual(requestUrl.searchParams.get('base'), '1');
    assert.strictEqual(requestUrl.searchParams.get('extended'), '2');
    assert.deepStrictEqual(observedState, {
      fromBase: true,
      fromOverride: true,
    });
  });

  test('should preserve ordered header tuples and original header names', async () => {
    const response = await fetch(`${getBaseUrl()}/headers/raw`, {
      browser: 'chrome_137',
      disableDefaultHeaders: true,
      headers: [
        ['x-lower', 'one'],
        ['X-Mixed', 'two'],
      ],
    });

    const body = await response.json<{ rawHeaders: string[] }>();
    const lowerIndex = body.rawHeaders.indexOf('x-lower');
    const mixedIndex = body.rawHeaders.indexOf('X-Mixed');

    assert.ok(lowerIndex >= 0, 'raw headers should include original lowercase name');
    assert.ok(mixedIndex >= 0, 'raw headers should include original mixed-case name');
    assert.ok(lowerIndex < mixedIndex, 'tuple header order should be preserved');
    assert.strictEqual(body.rawHeaders[lowerIndex + 1], 'one');
    assert.strictEqual(body.rawHeaders[mixedIndex + 1], 'two');
  });

  test('should accept advanced emulation options', async () => {
    const response = await fetch(`${getBaseUrl()}/headers/raw`, {
      browser: 'chrome_137',
      tlsOptions: {
        greaseEnabled: true,
      },
      http1Options: {
        writev: true,
      },
      http2Options: {
        adaptiveWindow: false,
        maxConcurrentStreams: 64,
      },
    });

    assert.strictEqual(response.status, 200);
  });

  test('should support native-like Request instances', async () => {
    const request = new WreqRequest('https://httpbin.org/anything', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ via: 'request' }),
    });

    assert.strictEqual(request.method, 'POST');
    assert.strictEqual(await request.clone().text(), JSON.stringify({ via: 'request' }));

    const response = await fetch(request, {
      browser: 'chrome_137',
      timeout: 15000,
    });

    const body = await response.json<{ method: string; data: string }>();

    assert.strictEqual(body.method, 'POST');
    assert.strictEqual(body.data, JSON.stringify({ via: 'request' }));
  });
});
