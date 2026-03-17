import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { Response as WreqResponse, createClient, fetch, getProfiles } from '../node-wreq';

describe('node-wreq', () => {
  before(() => {
    console.log('🚀 node-wreq - Test Suite\n');
  });

  test('should return available browser profiles', () => {
    const profiles = getProfiles();

    assert.ok(Array.isArray(profiles), 'Profiles should be an array');
    assert.ok(profiles.length > 0, 'Should have at least one profile');
    assert.ok(
      profiles.includes('chrome_137') ||
        profiles.includes('firefox_139') ||
        profiles.includes('safari_18'),
      'Should include standard browser profiles',
    );

    console.log('   Available profiles:', profiles.join(', '));
  });

  test('should make a simple GET request', async () => {
    const response = await fetch('https://httpbin.org/get', {
      browser: 'chrome_131',
      timeout: 15000,
    });

    assert.ok(response.status >= 200 && response.status < 300, 'Should return successful status');
    assert.ok(Object.keys(response.headers).length > 0, 'Should have response headers');
    assert.ok(response.body.length > 0, 'Should have response body');

    const body = await response.json<{ headers: Record<string, string> }>();
    assert.ok(body.headers['User-Agent'], 'Should have User-Agent header');

    console.log('   Status:', response.status);
    console.log('   User-Agent:', body.headers['User-Agent']);
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

      console.log(`   ${browser}:`, data['user-agent'].substring(0, 50) + '...');
    }
  });

  test('should handle timeout errors', async () => {
    await assert.rejects(
      async () => {
        await fetch('https://httpbin.org/delay/10', {
          browser: 'chrome_137',
          timeout: 1000, // 1 second timeout for 10 second delay
        });
      },
      {
        name: 'RequestError',
      },
      'Should throw an error on timeout',
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
      'Client defaults should be merged into outgoing requests',
    );
  });

  test('should run init and beforeRequest hooks', async () => {
    const response = await fetch('https://httpbin.org/anything', {
      browser: 'chrome_137',
      timeout: 15000,
      hooks: {
        init: [
          ({ options }) => {
            options.query = { from: 'init-hook' };
          },
        ],
        beforeRequest: [
          ({ request }) => {
            request.headers.set('X-Hook-Header', 'active');
          },
        ],
      },
    });

    const body = await response.json<{
      args: Record<string, string>;
      headers: Record<string, string>;
    }>();

    assert.strictEqual(body.args.from, 'init-hook', 'Init hook should mutate query');
    assert.strictEqual(
      body.headers['X-Hook-Header'],
      'active',
      'beforeRequest should mutate headers',
    );
  });

  test('should allow afterResponse to replace the response', async () => {
    const response = await fetch('https://httpbin.org/status/201', {
      browser: 'chrome_137',
      timeout: 15000,
      hooks: {
        afterResponse: [
          () =>
            new WreqResponse({
              status: 299,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ replaced: true }),
              cookies: {},
              url: 'https://local/replaced',
            }),
        ],
      },
    });

    assert.strictEqual(response.status, 299, 'afterResponse should replace the response');
    const body = await response.json<{ replaced: boolean }>();
    assert.strictEqual(body.replaced, true, 'Replaced response body should be returned');
  });

  test('should allow beforeError to rewrite thrown errors', async () => {
    await assert.rejects(
      async () => {
        await fetch('https://httpbin.org/status/418', {
          browser: 'chrome_137',
          timeout: 15000,
          throwHttpErrors: true,
          hooks: {
            beforeError: [
              ({ error }) => {
                error.message = `hooked: ${error.message}`;
                return error;
              },
            ],
          },
        });
      },
      (error: unknown) =>
        error instanceof Error && error.message.includes('hooked: Request failed with status 418'),
      'beforeError should be able to rewrite the final error',
    );
  });

  test('should reject cookieJar until it is implemented', async () => {
    await assert.rejects(
      async () => {
        await fetch('https://httpbin.org/get', {
          browser: 'chrome_137',
          cookieJar: {
            getCookies: () => [],
            setCookie: () => undefined,
          },
        });
      },
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('cookieJar support is not implemented yet'),
      'cookieJar should fail explicitly until the runtime support lands',
    );
  });
});
