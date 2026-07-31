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

    for (const profile of [
      'chrome_149',
      'edge_148',
      'firefox_151',
      'opera_131',
      'safari_26_4',
    ] as const) {
      assert.ok(profiles.includes(profile), `Should include upstream profile ${profile}`);
    }
  });

  test('should make a simple GET request', async () => {
    const response = await fetch(`${getBaseUrl()}/get`, {
      browser: 'chrome_131',
      timeout: 15000,
    });

    assert.ok(response.status >= 200 && response.status < 300, 'Should return successful status');
    assert.ok(Object.keys(response.headers).length > 0, 'Should have response headers');

    const body = await response.json<{ headers: Record<string, string> }>();

    assert.ok(body.headers['user-agent'], 'Should have User-Agent header');
  });

  test('should work with different browser profiles', async () => {
    const testUrl = `${getBaseUrl()}/user-agent`;
    const browsers = ['chrome_149', 'firefox_151', 'safari_26_4'] as const;

    for (const browser of browsers) {
      const response = await fetch(testUrl, {
        browser,
        timeout: 30000,
      });

      assert.ok(response.status === 200, `${browser} should return status 200`);

      const data = await response.json<Record<string, string>>();

      assert.ok(data['user-agent'], `${browser} should have user-agent`);
    }
  });

  test('should support fixed platform and automatic emulation selection', async () => {
    for (const browser of [
      { profile: 'chrome_149', platform: 'windows' },
      { mode: 'random' },
      { mode: 'weighted-random' },
    ] as const) {
      const response = await fetch(`${getBaseUrl()}/headers/raw`, { browser });
      const data = await response.json<{ headers: Record<string, string> }>();

      assert.ok(data.headers['user-agent']);
    }

    await assert.rejects(
      fetch(`${getBaseUrl()}/headers/raw`, {
        browser: { mode: 'weighted-random', profile: 'chrome_149' },
      }),
      /cannot be used with mode weighted-random/
    );

    const withoutProfileHeaders = await fetch(`${getBaseUrl()}/headers/raw`, {
      browser: {
        profile: 'chrome_149',
        http2: false,
        headers: false,
      },
    });

    const withoutProfileHeadersBody = await withoutProfileHeaders.json<{
      headers: Record<string, string>;
    }>();

    assert.strictEqual(withoutProfileHeadersBody.headers['user-agent'], undefined);
  });

  test('should handle timeout errors', async () => {
    await assert.rejects(
      async () => {
        await fetch(`${getBaseUrl()}/timings/delay?ms=10000`, {
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
    client.close();
  });

  test('should reuse and partition native pooled connections', async () => {
    const client = createClient({ baseURL: getBaseUrl(), http1Only: true });

    const readConnectionId = async (init?: {
      connectionGroup?: string;
      forbidConnectionReuse?: boolean;
    }) => {
      const response = await client.get('/connection/id', init);

      return (await response.json<{ connectionId: number }>()).connectionId;
    };

    const first = await readConnectionId({ connectionGroup: 'primary' });
    const reused = await readConnectionId({ connectionGroup: 'primary' });
    const isolated = await readConnectionId({ connectionGroup: 'isolated' });

    assert.strictEqual(reused, first);
    assert.notStrictEqual(isolated, first);

    const poisoned = await readConnectionId({
      connectionGroup: 'primary',
      forbidConnectionReuse: true,
    });

    const replacement = await readConnectionId({ connectionGroup: 'primary' });

    assert.strictEqual(poisoned, first);
    assert.notStrictEqual(replacement, first);

    const dynamicResponse = await client.get('/connection/id', {
      connectionGroup: 'primary',
    });

    assert.strictEqual(dynamicResponse.wreq.forbidConnectionReuse(), true);

    const dynamicallyPoisoned = (await dynamicResponse.json<{ connectionId: number }>())
      .connectionId;

    const dynamicReplacement = await readConnectionId({ connectionGroup: 'primary' });

    assert.strictEqual(dynamicallyPoisoned, replacement);
    assert.notStrictEqual(dynamicReplacement, replacement);

    client.close();

    await assert.rejects(client.get('/connection/id'), /Client is closed/);
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
    const response = await fetch(`${getBaseUrl()}/get`, {
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
      baseURL: getBaseUrl(),
      timeout: 15000,
      headers: {
        'X-Test-Client': 'node-wreq',
      },
    });

    const response = await client.get('/headers');
    const body = await response.json<{ headers: Record<string, string> }>();

    assert.strictEqual(
      body.headers['x-test-client'],
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
        keyShares: ['X25519_MLKEM768', 'X25519', 'P256'],
        certificateCompressionAlgorithms: ['brotli', 'zlib', 'zstd'],
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

    await assert.rejects(
      fetch(`${getBaseUrl()}/headers/raw`, {
        tlsOptions: {
          keyShares: ['X25519'],
          keySharesLimit: 1,
        },
      }),
      /keyShares and keySharesLimit cannot both be set/
    );
  });

  test('should reject HTTP/2 experimental settings removed by upstream', async () => {
    await assert.rejects(
      fetch(`${getBaseUrl()}/headers/raw`, {
        http2Options: {
          experimentalSettings: [{ id: 10, value: 1 }],
        },
      }),
      /wreq 6\.0\.0-rc\.29 no longer exposes custom HTTP\/2 settings/
    );
  });

  test('should support native-like Request instances', async () => {
    const request = new WreqRequest(`${getBaseUrl()}/anything`, {
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
