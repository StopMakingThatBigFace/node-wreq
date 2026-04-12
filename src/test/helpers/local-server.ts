import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { after, before } from 'node:test';
import { WebSocketServer, type WebSocket as WsPeer } from 'ws';

export function onceEvent<T extends Event>(target: EventTarget, type: string): Promise<T> {
  return new Promise((resolve) => {
    const listener = (event: Event) => {
      resolve(event as T);
    };

    target.addEventListener(type, listener, { once: true });
  });
}

export function setupLocalTestServer() {
  let localBaseUrl = '';
  let localServer: Server | undefined;
  let wsServer: WebSocketServer | undefined;
  const retryAttempts = new Map<string, number>();

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

      socket.send(
        JSON.stringify({
          kind: 'connected',
          cookie,
          protocol: socket.protocol,
          rawHeaders: request.rawHeaders,
        })
      );

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

      if (url.pathname === '/headers/raw') {
        sendJson(response, 200, {
          rawHeaders: request.rawHeaders,
          headers: request.headers,
        });

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

  return {
    getBaseUrl() {
      return localBaseUrl;
    },
    retryAttempts,
  };
}
