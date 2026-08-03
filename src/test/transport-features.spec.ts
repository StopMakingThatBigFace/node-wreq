import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { createClient, fetch, Request } from '../node-wreq';
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

    const body = await response.json<{
      body: string;
      bodyBase64: string;
      headers: Record<string, string>;
    }>();

    assert.match(
      body.headers['content-type'],
      /^multipart\/form-data; boundary=----WebKitFormBoundary[0-9A-Za-z]{16}$/,
      'multipart bodies should use a WebKit-style boundary'
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

    assert.strictEqual(
      Number(body.headers['content-length']),
      Buffer.from(body.bodyBase64, 'base64').byteLength,
      'native multipart should retain an exact content length while streaming files'
    );
  });

  test('should stream FormData files without calling Blob.arrayBuffer()', async () => {
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    const formData = new FormData();

    formData.append(
      'upload',
      new File([Buffer.alloc(1024 * 1024, 0x61)], 'streamed.bin', {
        type: 'application/octet-stream',
      })
    );

    Blob.prototype.arrayBuffer = async () => {
      throw new Error('Blob.arrayBuffer() must not be used by multipart dispatch');
    };

    try {
      const response = await fetch(`${getBaseUrl()}/body/echo`, {
        method: 'POST',
        body: formData,
      });

      const body = await response.json<{ bodyBase64: string }>();

      assert.ok(body.bodyBase64.length > 1024 * 1024, 'the complete file should reach the server');
    } finally {
      Blob.prototype.arrayBuffer = originalArrayBuffer;
    }
  });

  test('should cancel an active multipart file stream when the request is aborted', async () => {
    let streamCancelled = false;

    class SlowFile extends File {
      override stream(): ReadableStream<Uint8Array> {
        const reader = super.stream().getReader();

        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            await new Promise((resolve) => setTimeout(resolve, 25));

            const result = await reader.read();

            if (result.done) {
              controller.close();
            } else {
              controller.enqueue(result.value);
            }
          },
          async cancel(reason) {
            streamCancelled = true;

            await reader.cancel(reason);
          },
        });
      }
    }

    const controller = new AbortController();
    const formData = new FormData();

    formData.append('upload', new SlowFile([Buffer.alloc(4 * 1024 * 1024)], 'slow.bin'));

    const pending = fetch(`${getBaseUrl()}/body/echo`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(new Error('stop multipart upload')), 10);

    await assert.rejects(pending, (error: unknown) => {
      return error instanceof Error && error.name === 'AbortError';
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(streamCancelled, true);
  });

  test('should propagate multipart source stream failures', async () => {
    class BrokenFile extends File {
      override stream(): ReadableStream<Uint8Array> {
        throw new Error('broken multipart source');
      }
    }

    const formData = new FormData();

    formData.append('upload', new BrokenFile(['broken'], 'broken.bin'));

    await assert.rejects(
      fetch(`${getBaseUrl()}/body/echo`, {
        method: 'POST',
        body: formData,
      }),
      (error: unknown) => {
        return error instanceof Error && error.message.includes('broken multipart source');
      }
    );
  });

  test('should recreate multipart streams for retries', async () => {
    const formData = new FormData();
    const key = `multipart-${Date.now()}-${Math.random()}`;

    formData.append('alpha', 'retry');
    formData.append('upload', new File(['retry me'], 'retry.txt', { type: 'text/plain' }));

    const response = await fetch(
      `${getBaseUrl()}/retry/body?key=${encodeURIComponent(key)}&failCount=1`,
      {
        method: 'POST',
        body: formData,
        retry: {
          limit: 1,
          methods: ['POST'],
          statusCodes: [503],
        },
      }
    );

    const body = await response.json<{ attempt: number; body: string }>();

    assert.strictEqual(body.attempt, 2);
    assert.ok(body.body.includes('retry me'));
    assert.ok(body.body.includes('filename="retry.txt"'));
  });

  test('should recreate multipart streams for preserving redirects', async () => {
    const formData = new FormData();

    formData.append('alpha', 'redirect');
    formData.append('upload', new File(['redirect me'], 'redirect.txt', { type: 'text/plain' }));

    const response = await fetch(`${getBaseUrl()}/redirect/preserve-body`, {
      method: 'POST',
      body: formData,
    });

    const body = await response.json<{ method: string; body: string }>();

    assert.strictEqual(body.method, 'POST');
    assert.ok(body.body.includes('redirect me'));
    assert.ok(body.body.includes('filename="redirect.txt"'));
  });

  test('should preserve browser-style multipart escaping and line endings', async () => {
    const formData = new FormData();

    formData.append('quoted"\nname', 'first\nsecond');
    formData.append('upload', new File(['value'], 'quoted"\nfile.txt', { type: 'text/plain' }));

    const response = await fetch(`${getBaseUrl()}/body/echo`, {
      method: 'POST',
      body: formData,
    });

    const body = await response.json<{ body: string }>();

    assert.ok(body.body.includes('name="quoted%22%0D%0Aname"'));
    assert.ok(body.body.includes('first\r\nsecond'));
    assert.ok(body.body.includes('filename="quoted%22%0D%0Afile.txt"'));
  });

  test('should support an explicit multipart boundary', async () => {
    const formData = new FormData();

    formData.append('alpha', 'custom-boundary');

    const response = await fetch(`${getBaseUrl()}/body/echo`, {
      method: 'POST',
      body: formData,
      multipartBoundary: '----node-wreq-test-boundary',
    });

    const body = await response.json<{ body: string; headers: Record<string, string> }>();

    assert.strictEqual(
      body.headers['content-type'],
      'multipart/form-data; boundary=----node-wreq-test-boundary'
    );

    assert.ok(body.body.startsWith('------node-wreq-test-boundary\r\n'));
    assert.ok(body.body.endsWith('------node-wreq-test-boundary--\r\n'));
  });

  test('should preserve multipart request bodies when cloning requests', async () => {
    const formData = new FormData();

    formData.append('alpha', '1');
    formData.append(
      'upload',
      new File([Buffer.from('hello multipart')], 'hello.txt', { type: 'text/plain' })
    );

    const request = new Request(`${getBaseUrl()}/body/echo`, {
      method: 'POST',
      body: formData,
    });

    const cloned = request.clone();
    const response = await fetch(cloned);
    const body = await response.json<{ body: string }>();

    assert.ok(body.body.includes('name="alpha"'));
    assert.ok(body.body.includes('name="upload"'));
    assert.ok(body.body.includes('filename="hello.txt"'));
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

  test('should omit accept-encoding when compression is disabled', async () => {
    const compressed = await fetch(`${getBaseUrl()}/headers/raw`, {
      browser: 'chrome_137',
    });

    const compressedBody = await compressed.json<{ headers: Record<string, string> }>();

    assert.ok(
      compressedBody.headers['accept-encoding'],
      'compression-enabled requests should advertise accept-encoding'
    );

    const uncompressed = await fetch(`${getBaseUrl()}/headers/raw`, {
      browser: 'chrome_137',
      compress: false,
    });

    const uncompressedBody = await uncompressed.json<{ headers: Record<string, string> }>();

    assert.strictEqual(
      uncompressedBody.headers['accept-encoding'],
      undefined,
      'compression-disabled requests should not send accept-encoding'
    );
  });

  test('should apply readTimeout independently from total timeout', async () => {
    const response = await fetch(
      `${getBaseUrl()}/stream/slow?chunks=3&chunkBytes=1024&delayMs=300`,
      {
        timeout: 0,
        readTimeout: 100,
      }
    );

    await assert.rejects(
      async () => {
        await response.arrayBuffer();
      },
      (error: unknown) => error instanceof Error && error.name === 'TimeoutError'
    );
  });

  test('should release a timed-out response body from a single-connection pool', async () => {
    const client = createClient({
      baseURL: getBaseUrl(),
      poolMaxSize: 1,
      timeout: 1_000,
    });

    try {
      const response = await client.get('/stream/slow?chunks=3&chunkBytes=1024&delayMs=300', {
        timeout: 0,
        readTimeout: 100,
      });

      await assert.rejects(
        response.arrayBuffer(),
        (error: unknown) => error instanceof Error && error.name === 'TimeoutError'
      );

      const next = await client.get('/get');

      assert.strictEqual(next.status, 200);

      await next.body?.cancel();
    } finally {
      client.close();
    }
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

  test('should preserve duplicate response headers like fetch', async () => {
    const response = await fetch(`${getBaseUrl()}/headers/duplicates`);

    assert.strictEqual(response.headers.get('x-dupe'), 'one, two');
    assert.deepStrictEqual(response.headers.getSetCookie(), [
      'session=abc123; Path=/',
      'csrf=token123; Path=/',
    ]);

    assert.strictEqual(
      response.headers.get('set-cookie'),
      'session=abc123; Path=/, csrf=token123; Path=/'
    );

    const cloned = response.clone();

    assert.strictEqual(cloned.headers.get('x-dupe'), 'one, two');
    assert.deepStrictEqual(cloned.headers.getSetCookie(), [
      'session=abc123; Path=/',
      'csrf=token123; Path=/',
    ]);
  });

  test('should reject non-HTTPS DoH endpoints', async () => {
    await assert.rejects(
      () =>
        fetch(`${getBaseUrl()}/headers/raw`, {
          dns: {
            doh: 'http://cloudflare-dns.com/dns-query',
          },
        }),
      /dns\.doh must be an HTTPS URL/
    );
  });

  test('should reject non-tls DoT endpoints', async () => {
    await assert.rejects(
      () =>
        fetch(`${getBaseUrl()}/headers/raw`, {
          dns: {
            dot: 'https://cloudflare-dns.com',
          },
        }),
      /dns\.dot must be a tls:\/\/ URL/
    );
  });

  test('should reject conflicting encrypted DNS endpoints', async () => {
    await assert.rejects(
      () =>
        fetch(`${getBaseUrl()}/headers/raw`, {
          dns: {
            doh: 'https://cloudflare-dns.com/dns-query',
            dot: 'tls://cloudflare-dns.com',
          },
        }),
      /dns\.doh and dns\.dot cannot both be set/
    );
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

  test('should disable browser preset headers when disableDefaultHeaders is true', async () => {
    const defaultResponse = await fetch(`${getBaseUrl()}/headers/raw`, {
      browser: 'chrome_137',
    });

    const defaultBody = await defaultResponse.json<{ headers: Record<string, string> }>();

    assert.ok(defaultBody.headers['user-agent'], 'browser presets should include user-agent');
    assert.ok(
      defaultBody.headers['accept-language'],
      'browser presets should include accept-language'
    );

    const strippedResponse = await fetch(`${getBaseUrl()}/headers/raw`, {
      browser: 'chrome_137',
      disableDefaultHeaders: true,
    });

    const strippedBody = await strippedResponse.json<{ headers: Record<string, string> }>();

    assert.strictEqual(strippedBody.headers['user-agent'], undefined);
    assert.strictEqual(strippedBody.headers['accept-language'], undefined);
    assert.strictEqual(strippedBody.headers['sec-ch-ua'], undefined);
    assert.ok(strippedBody.headers.host, 'transport-managed headers should still be present');
  });
});
