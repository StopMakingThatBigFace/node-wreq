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

  test('should preserve ordered header tuples and original header names when requested', async () => {
    const response = await fetch(`${getBaseUrl()}/headers/raw`, {
      browser: 'chrome_137',
      disableDefaultHeaders: true,
      keepOriginalHeaderNames: true,
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
