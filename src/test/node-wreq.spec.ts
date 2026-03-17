import assert from 'node:assert';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { test, describe, before, after } from 'node:test';
import { TextDecoder } from 'node:util';
import { WebSocketServer, type WebSocket as WsPeer } from 'ws';
import {
  CloseEvent as WreqCloseEvent,
  Response as WreqResponse,
  WebSocket as WreqWebSocket,
  createClient,
  fetch,
  getProfiles,
  websocket,
} from '../node-wreq';

describe('node-wreq', () => {
  let localBaseUrl = '';
  let localServer: Server | undefined;
  let wsServer: WebSocketServer | undefined;
  const retryAttempts = new Map<string, number>();

  function onceEvent<T extends Event>(target: EventTarget, type: string): Promise<T> {
    return new Promise((resolve) => {
      const listener = (event: Event) => {
        resolve(event as T);
      };

      target.addEventListener(type, listener, { once: true });
    });
  }

  function readCookieHeader(request: IncomingMessage): string {
    const cookie = request.headers.cookie;
    if (Array.isArray(cookie)) {
      return cookie.join('; ');
    }

    return cookie ?? '';
  }

  function sendJson(
    response: ServerResponse,
    status: number,
    body: unknown,
    headers?: Record<string, string | string[]>
  ) {
    response.writeHead(status, {
      'content-type': 'application/json',
      ...headers,
    });
    response.end(JSON.stringify(body));
  }

  before(() => {
    console.log('🚀 node-wreq - Test Suite\n');
  });

  before(async () => {
    wsServer = new WebSocketServer({
      noServer: true,
      perMessageDeflate: true,
      handleProtocols(protocols: Set<string>) {
        if (protocols.has('chat')) {
          return 'chat';
        }

        return false;
      },
    });

    wsServer.on('connection', (socket: WsPeer, request: IncomingMessage) => {
      const cookie = readCookieHeader(request);
      socket.send(JSON.stringify({ kind: 'connected', cookie, protocol: socket.protocol }));

      socket.on('message', (data: Buffer, isBinary: boolean) => {
        if (!isBinary && data.toString() === 'close-me') {
          socket.close(1000, 'done');
          return;
        }

        socket.send(data, { binary: isBinary });
      });
    });

    localServer = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/retry') {
        const key = url.searchParams.get('key') ?? 'default';
        const failCount = Number(url.searchParams.get('failCount') ?? '0');
        const count = (retryAttempts.get(key) ?? 0) + 1;
        retryAttempts.set(key, count);

        if (count <= failCount) {
          sendJson(response, 503, { attempt: count, retried: false });
          return;
        }

        sendJson(response, 200, { attempt: count, retried: count > 1 });
        return;
      }

      if (url.pathname === '/timings/delay') {
        setTimeout(() => {
          sendJson(response, 200, { delayed: true });
        }, 50);
        return;
      }

      if (url.pathname === '/cookies/set') {
        sendJson(
          response,
          200,
          { stored: true },
          {
            'set-cookie': 'session=abc123',
          }
        );
        return;
      }

      if (url.pathname === '/cookies/set-multiple') {
        sendJson(
          response,
          200,
          { stored: true },
          {
            'set-cookie': ['session=abc123; Path=/', 'csrf=token123; Path=/'],
          }
        );
        return;
      }

      if (url.pathname === '/cookies/echo') {
        sendJson(response, 200, { cookie: readCookieHeader(request) });
        return;
      }

      if (url.pathname === '/redirect/start') {
        response.writeHead(302, {
          location: '/redirect/final',
          'set-cookie': 'redirect_session=1; Path=/',
        });
        response.end();
        return;
      }

      if (url.pathname === '/redirect/post-start') {
        response.writeHead(302, {
          location: '/redirect/final',
        });
        response.end();
        return;
      }

      if (url.pathname === '/redirect/final') {
        sendJson(response, 200, {
          method: request.method,
          cookie: readCookieHeader(request),
          hookHeader: request.headers['x-redirect-hook'] ?? '',
        });
        return;
      }

      sendJson(response, 404, { path: url.pathname });
    });

    localServer.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }

      wsServer?.handleUpgrade(request, socket, head, (websocketSocket: WsPeer) => {
        wsServer?.emit('connection', websocketSocket, request);
      });
    });

    await new Promise<void>((resolve) => {
      localServer?.listen(0, '127.0.0.1', () => {
        const address = localServer?.address();
        if (!address || typeof address === 'string') {
          throw new Error('Failed to bind local test server');
        }

        localBaseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      wsServer?.close(() => resolve());
    });

    await new Promise<void>((resolve, reject) => {
      localServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

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

    console.log('   Available profiles:', profiles.join(', '));
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
      'beforeRequest should mutate headers'
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

  test('should expose fetch-style response body lifecycle', async () => {
    const response = new WreqResponse({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ streamed: true }),
      cookies: {},
      setCookies: [],
      url: 'https://local/body',
    });

    assert.strictEqual(response.bodyUsed, false, 'body should start unused');

    const bodyStream = response.body;
    assert.ok(bodyStream, 'body should expose a stream');
    assert.strictEqual(response.bodyUsed, true, 'accessing body should mark it used');

    const reader = bodyStream?.getReader();
    const chunks: Uint8Array[] = [];

    while (reader) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      chunks.push(result.value);
    }

    const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    assert.strictEqual(
      new TextDecoder().decode(merged),
      JSON.stringify({ streamed: true }),
      'body stream should contain the response payload'
    );

    await assert.rejects(
      async () => {
        await response.text();
      },
      (error: unknown) => error instanceof TypeError && error.message.includes('already used'),
      'consumers should reject after the body is used'
    );
  });

  test('should support cloning unused responses', async () => {
    const response = new WreqResponse({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cloned: true }),
      cookies: {},
      setCookies: [],
      url: 'https://local/clone',
    });

    const cloned = response.clone();
    assert.notStrictEqual(cloned, response, 'clone should return a new response instance');
    assert.strictEqual(await cloned.text(), JSON.stringify({ cloned: true }));
    assert.strictEqual(await response.text(), JSON.stringify({ cloned: true }));
  });

  test('should expose native-backed response streams for fetched responses', async () => {
    const response = await fetch(`${localBaseUrl}/cookies/echo`);
    const stream = response.body;

    assert.ok(stream, 'fetched response should expose a body stream');
    assert.strictEqual(response.bodyUsed, true, 'reading body stream should mark it used');

    const reader = stream?.getReader();
    const chunks: Uint8Array[] = [];
    while (reader) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      chunks.push(result.value);
    }

    const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    assert.ok(
      new TextDecoder().decode(merged).includes('"cookie":""'),
      'streamed native response should contain the expected payload'
    );
  });

  test('should support formData for urlencoded responses', async () => {
    const response = new WreqResponse({
      status: 200,
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: 'alpha=1&beta=two&beta=three',
      cookies: {},
      setCookies: [],
      url: 'https://local/form',
    });

    const formData = await response.formData();
    assert.strictEqual(formData.get('alpha'), '1');
    assert.deepStrictEqual(formData.getAll('beta'), ['two', 'three']);
    assert.strictEqual(response.bodyUsed, true, 'formData should consume the body');
  });

  test('should reject unsupported multipart formData parsing for now', async () => {
    const response = new WreqResponse({
      status: 200,
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
      body: '--test\r\ncontent-disposition: form-data; name="alpha"\r\n\r\n1\r\n--test--\r\n',
      cookies: {},
      setCookies: [],
      url: 'https://local/form',
    });

    await assert.rejects(
      async () => {
        await response.formData();
      },
      (error: unknown) =>
        error instanceof TypeError && error.message.includes('multipart/form-data parsing'),
      'multipart form parsing should fail explicitly until it is implemented'
    );
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
      'beforeError should be able to rewrite the final error'
    );
  });

  test('should run beforeRetry hooks and retry retriable responses', async () => {
    retryAttempts.set('status-retry', 0);
    const hookAttempts: number[] = [];

    const response = await fetch(`${localBaseUrl}/retry?key=status-retry&failCount=2`, {
      retry: {
        limit: 2,
        statusCodes: [503],
        backoff: () => 0,
      },
      hooks: {
        beforeRetry: [
          ({ attempt, response: retryResponse }) => {
            hookAttempts.push(attempt);
            assert.strictEqual(retryResponse?.status, 503);
          },
        ],
      },
    });

    assert.strictEqual(response.status, 200, 'request should eventually succeed');
    assert.deepStrictEqual(
      hookAttempts,
      [2, 3],
      'beforeRetry should run before each retry attempt'
    );

    const body = await response.json<{ attempt: number; retried: boolean }>();
    assert.strictEqual(body.attempt, 3, 'third attempt should be the successful response');
    assert.strictEqual(body.retried, true, 'server should observe retries');
  });

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

    const setResponse = await fetch(`${localBaseUrl}/cookies/set`, {
      cookieJar,
    });
    assert.strictEqual(setResponse.status, 200, 'cookie source request should succeed');
    assert.strictEqual(
      jarStore.get('session'),
      'abc123',
      'cookieJar should persist response cookies'
    );

    const echoResponse = await fetch(`${localBaseUrl}/cookies/echo`, {
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

    const response = await fetch(`${localBaseUrl}/cookies/set-multiple`, {
      cookieJar,
    });

    assert.strictEqual(response.status, 200, 'multiple set-cookie response should succeed');
    assert.deepStrictEqual(
      rawCookies,
      ['session=abc123; Path=/', 'csrf=token123; Path=/'],
      'cookieJar should receive each raw Set-Cookie value separately'
    );

    const echoResponse = await fetch(`${localBaseUrl}/cookies/echo`, {
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
        return [...this.store.entries()].map(([name, value]) => ({ name, value }));
      },
      setCookie(this: { store: Map<string, string> }, cookie: string) {
        const [pair] = cookie.split(';');
        const [name, value = ''] = pair.split('=');
        this.store.set(name, value);
      },
    };

    const response = await fetch(`${localBaseUrl}/redirect/start`, {
      cookieJar,
      hooks: {
        beforeRedirect: [
          ({ request, redirectCount, nextUrl }) => {
            assert.strictEqual(redirectCount, 1);
            assert.strictEqual(nextUrl, `${localBaseUrl}/redirect/final`);
            request.headers.set('X-Redirect-Hook', 'active');
          },
        ],
      },
    });

    assert.strictEqual(response.status, 200, 'redirect chain should resolve to final response');
    assert.strictEqual(response.redirected, true, 'final response should be marked redirected');
    assert.strictEqual(response.redirectChain.length, 1, 'redirect chain should be recorded');

    const body = await response.json<{ method: string; cookie: string; hookHeader: string }>();
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
    const response = await fetch(`${localBaseUrl}/redirect/post-start`, {
      method: 'POST',
      body: 'hello',
    });

    const body = await response.json<{ method: string }>();
    assert.strictEqual(body.method, 'GET', '302 redirect from POST should be rewritten to GET');
  });

  test('should support manual redirect mode', async () => {
    const response = await fetch(`${localBaseUrl}/redirect/start`, {
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
        await fetch(`${localBaseUrl}/redirect/start`, {
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

  test('should expose a WHATWG-like websocket helper and lifecycle', async () => {
    const socket = await websocket(localBaseUrl.replace('http://', 'ws://') + '/ws', {
      protocols: 'chat',
    });

    assert.strictEqual(socket.readyState, WreqWebSocket.OPEN);
    assert.strictEqual(socket.protocol, 'chat');

    const connectedEvent = await onceEvent<MessageEvent>(socket, 'message');
    const connected = JSON.parse(String(connectedEvent.data)) as {
      kind: string;
      cookie: string;
      protocol: string;
    };
    assert.strictEqual(connected.kind, 'connected');
    assert.strictEqual(connected.protocol, 'chat');

    const replyPromise = onceEvent<MessageEvent>(socket, 'message');
    socket.send('hello');
    const replyEvent = await replyPromise;
    assert.strictEqual(replyEvent.data, 'hello');

    const closePromise = onceEvent<WreqCloseEvent>(socket, 'close');
    socket.close(1000, 'done');
    const closeEvent = await closePromise;

    assert.strictEqual(closeEvent.code, 1000);
    assert.strictEqual(closeEvent.reason, 'done');
    assert.strictEqual(closeEvent.wasClean, true);
    assert.strictEqual(socket.readyState, WreqWebSocket.CLOSED);
  });

  test('should support binary messages and arraybuffer binaryType', async () => {
    const socket = new WreqWebSocket(localBaseUrl.replace('http://', 'ws://') + '/ws', {
      binaryType: 'arraybuffer',
    });

    await onceEvent<Event>(socket, 'open');
    await onceEvent<MessageEvent>(socket, 'message');

    const replyPromise = onceEvent<MessageEvent>(socket, 'message');
    socket.send(new Uint8Array([1, 2, 3]));
    const replyEvent = await replyPromise;

    assert.ok(replyEvent.data instanceof ArrayBuffer);
    assert.deepStrictEqual([...new Uint8Array(replyEvent.data)], [1, 2, 3]);

    const closePromise = onceEvent<WreqCloseEvent>(socket, 'close');
    socket.close(1000, 'done');
    await closePromise;
  });

  test('should send cookieJar cookies during websocket handshake', async () => {
    const cookieJar = {
      getCookies: () => [{ name: 'session', value: 'ws123' }],
      setCookie: () => {},
    };

    const socket = await websocket(localBaseUrl.replace('http://', 'ws://') + '/ws', {
      cookieJar,
    });

    const connectedEvent = await onceEvent<MessageEvent>(socket, 'message');
    const connected = JSON.parse(String(connectedEvent.data)) as { cookie: string };
    assert.ok(
      connected.cookie.includes('session=ws123'),
      'cookieJar cookies should be sent during the websocket handshake'
    );

    const closePromise = onceEvent<WreqCloseEvent>(socket, 'close');
    socket.close(1000, 'done');
    await closePromise;
  });

  test('should reject websocket URLs with fragments', () => {
    assert.throws(
      () => {
        new WreqWebSocket(localBaseUrl.replace('http://', 'ws://') + '/ws#fragment');
      },
      (error: unknown) => error instanceof DOMException && error.name === 'SyntaxError',
      'fragment websocket URLs should be rejected'
    );
  });

  test('should reject forbidden websocket headers and duplicate protocols', () => {
    assert.throws(
      () => {
        new WreqWebSocket(localBaseUrl.replace('http://', 'ws://') + '/ws', {
          headers: {
            Upgrade: 'websocket',
          },
        });
      },
      (error: unknown) => error instanceof DOMException && error.name === 'SyntaxError',
      'forbidden managed websocket headers should be rejected'
    );

    assert.throws(
      () => {
        new WreqWebSocket(localBaseUrl.replace('http://', 'ws://') + '/ws', {
          protocols: ['chat', 'chat'],
        });
      },
      (error: unknown) =>
        error instanceof SyntaxError && error.message.includes('Duplicate WebSocket subprotocol'),
      'duplicate websocket subprotocols should be rejected'
    );
  });

  test('should expose negotiated websocket extensions as a string', async () => {
    const socket = await websocket(localBaseUrl.replace('http://', 'ws://') + '/ws');
    assert.strictEqual(typeof socket.extensions, 'string');

    const closePromise = onceEvent<WreqCloseEvent>(socket, 'close');
    socket.close(1000, 'done');
    await closePromise;
  });

  test('should expose response timings and onStats callback data', async () => {
    let capturedStats:
      | {
          attempt: number;
          wait: number;
          status?: number;
        }
      | undefined;

    const response = await fetch(`${localBaseUrl}/timings/delay`, {
      onStats: ({ attempt, timings, response: statsResponse }) => {
        capturedStats = {
          attempt,
          wait: timings.wait,
          status: statsResponse?.status,
        };
      },
    });

    assert.ok(response.timings, 'response should expose timings');
    assert.ok((response.timings?.wait ?? 0) >= 20, 'timings should record server wait time');
    assert.strictEqual(capturedStats?.attempt, 1);
    assert.strictEqual(capturedStats?.status, 200);
    assert.ok((capturedStats?.wait ?? 0) >= 20, 'onStats should receive request timings');
  });
});
