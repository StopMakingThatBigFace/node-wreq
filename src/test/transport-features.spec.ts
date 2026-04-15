import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { fetch } from '../node-wreq';
import { setupLocalTestServer } from './helpers/local-server';
import { setupProxyTestServer } from './helpers/proxy-server';

describe('transport features', () => {
  const { getBaseUrl } = setupLocalTestServer();
  const proxyServer = setupProxyTestServer();

  test('should upload multipart FormData bodies like fetch', async () => {
    const formData = new FormData();

    formData.append('alpha', '1');
    formData.append('beta', 'two');
    formData.append(
      'upload',
      new File([Buffer.from('hello multipart')], 'hello.txt', { type: 'text/plain' })
    );

    const response = await fetch(`${getBaseUrl()}/body/echo`, {
      method: 'POST',
      body: formData,
    });
    const body = await response.json<{ body: string; headers: Record<string, string> }>();

    assert.match(
      body.headers['content-type'],
      /^multipart\/form-data; boundary=/,
      'multipart bodies should set a valid content-type boundary'
    );
    assert.ok(body.body.includes('name="alpha"'), 'multipart payload should include text fields');
    assert.ok(body.body.includes('name="beta"'), 'multipart payload should include all fields');
    assert.ok(
      body.body.includes('filename="hello.txt"'),
      'multipart payload should preserve filenames'
    );
    assert.ok(
      body.body.includes('hello multipart'),
      'multipart payload should include file contents'
    );
  });

  test('should decode response.text() using the declared charset', async () => {
    const response = await fetch(`${getBaseUrl()}/charset/windows-1251`);

    assert.strictEqual(await response.text(), 'Привет, мир!');
  });

  test('should transparently decompress zstd responses when compression is enabled', async () => {
    const response = await fetch(`${getBaseUrl()}/compress/zstd`);

    assert.strictEqual(await response.text(), 'zstd response ok');
    assert.strictEqual(
      response.headers.get('content-encoding'),
      null,
      'decompressed responses should not expose stale content-encoding headers'
    );
  });

  test('should support per-request DNS host overrides', async () => {
    const target = new URL(`${getBaseUrl()}/headers/raw`);

    target.hostname = 'example.test';

    const response = await fetch(target, {
      dns: {
        hosts: {
          'example.test': '127.0.0.1',
        },
      },
    });
    const body = await response.json<{ headers: Record<string, string> }>();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.headers.host, `example.test:${target.port}`);
  });

  test('should honor env/system proxy by default and allow opting out with proxy=false', async () => {
    const previous = {
      HTTP_PROXY: process.env.HTTP_PROXY,
      http_proxy: process.env.http_proxy,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      https_proxy: process.env.https_proxy,
      ALL_PROXY: process.env.ALL_PROXY,
      all_proxy: process.env.all_proxy,
      NO_PROXY: process.env.NO_PROXY,
      no_proxy: process.env.no_proxy,
    };

    try {
      process.env.HTTP_PROXY = proxyServer.getBaseUrl();
      process.env.http_proxy = proxyServer.getBaseUrl();
      delete process.env.HTTPS_PROXY;
      delete process.env.https_proxy;
      delete process.env.ALL_PROXY;
      delete process.env.all_proxy;
      delete process.env.NO_PROXY;
      delete process.env.no_proxy;

      proxyServer.resetHits();

      const proxiedResponse = await fetch(`${getBaseUrl()}/headers/raw`);

      assert.strictEqual(proxiedResponse.status, 200);
      assert.ok(proxyServer.getHits() > 0, 'requests should use env/system proxy by default');

      proxyServer.resetHits();

      const directResponse = await fetch(`${getBaseUrl()}/headers/raw`, {
        proxy: false,
      });

      assert.strictEqual(directResponse.status, 200);
      assert.strictEqual(proxyServer.getHits(), 0, 'proxy=false should bypass env/system proxy');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];

          continue;
        }

        process.env[key] = value;
      }
    }
  });
});
