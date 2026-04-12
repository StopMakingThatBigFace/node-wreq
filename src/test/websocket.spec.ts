import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { CloseEvent as WreqCloseEvent, WebSocket as WreqWebSocket, websocket } from '../node-wreq';
import { onceEvent, setupLocalTestServer } from './helpers/local-server';

describe('websocket', () => {
  const { getBaseUrl } = setupLocalTestServer();

  test('should expose a WHATWG-like websocket helper and lifecycle', async () => {
    const socket = await websocket(getBaseUrl().replace('http://', 'ws://') + '/ws', {
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
    const socket = new WreqWebSocket(getBaseUrl().replace('http://', 'ws://') + '/ws', {
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

    const socket = await websocket(getBaseUrl().replace('http://', 'ws://') + '/ws', {
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
        new WreqWebSocket(getBaseUrl().replace('http://', 'ws://') + '/ws#fragment');
      },
      (error: unknown) => error instanceof DOMException && error.name === 'SyntaxError',
      'fragment websocket URLs should be rejected'
    );
  });

  test('should reject forbidden websocket headers and duplicate protocols', () => {
    assert.throws(
      () => {
        new WreqWebSocket(getBaseUrl().replace('http://', 'ws://') + '/ws', {
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
        new WreqWebSocket(getBaseUrl().replace('http://', 'ws://') + '/ws', {
          protocols: ['chat', 'chat'],
        });
      },
      (error: unknown) =>
        error instanceof SyntaxError && error.message.includes('Duplicate WebSocket subprotocol'),
      'duplicate websocket subprotocols should be rejected'
    );
  });

  test('should expose negotiated websocket extensions as a string', async () => {
    const socket = await websocket(getBaseUrl().replace('http://', 'ws://') + '/ws');

    assert.strictEqual(typeof socket.extensions, 'string');

    const closePromise = onceEvent<WreqCloseEvent>(socket, 'close');

    socket.close(1000, 'done');
    await closePromise;
  });

  test('should preserve handshake header names and expose bufferedAmount', async () => {
    const socket = await websocket(getBaseUrl().replace('http://', 'ws://') + '/ws', {
      browser: 'chrome_137',
      disableDefaultHeaders: true,
      keepOriginalHeaderNames: true,
      headers: [
        ['x-lower', 'one'],
        ['X-Mixed', 'two'],
      ],
    });

    const connectedEvent = await onceEvent<MessageEvent>(socket, 'message');
    const payload = JSON.parse(String(connectedEvent.data)) as { rawHeaders: string[] };
    const lowerIndex = payload.rawHeaders.indexOf('x-lower');
    const mixedIndex = payload.rawHeaders.indexOf('X-Mixed');

    assert.ok(lowerIndex >= 0, 'handshake should preserve lowercase header name');
    assert.ok(mixedIndex >= 0, 'handshake should preserve mixed-case header name');
    assert.ok(lowerIndex < mixedIndex, 'handshake tuple order should be preserved');

    const largePayload = 'x'.repeat(256 * 1024);

    socket.send(largePayload);
    assert.ok(
      socket.bufferedAmount >= Buffer.byteLength(largePayload),
      'bufferedAmount should reflect queued outgoing bytes'
    );

    await onceEvent<MessageEvent>(socket, 'message');
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
    assert.strictEqual(socket.bufferedAmount, 0, 'bufferedAmount should drain after send');

    const closePromise = onceEvent<WreqCloseEvent>(socket, 'close');

    socket.close(1000, 'done');
    await closePromise;
  });
});
