import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { after, before } from 'node:test';
import { WebSocketServer, type WebSocket as WsPeer } from 'ws';

const WINDOWS_1251_BODY = Buffer.from('cff0e8e2e5f22c20ece8f021', 'hex');
const ZSTD_RESPONSE_BODY = Buffer.from('KLUv/QRYgQAAenN0ZCByZXNwb25zZSBva4lnadQ=', 'base64');

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

  async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
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
      void (async () => {
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
          const delayMs = Number(url.searchParams.get('ms') ?? '50');

          setTimeout(() => {
            sendJson(response, 200, { delayed: true });
          }, delayMs);

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

        if (url.pathname === '/body/echo') {
          const body = await readRequestBody(request);

          sendJson(response, 200, {
            method: request.method,
            headers: request.headers,
            body: body.toString('utf8'),
            bodyBase64: body.toString('base64'),
          });

          return;
        }

        if (url.pathname === '/charset/windows-1251') {
          response.writeHead(200, {
            'content-type': 'text/plain; charset=windows-1251',
            'content-length': String(WINDOWS_1251_BODY.length),
          });
          response.end(WINDOWS_1251_BODY);

          return;
        }

        if (url.pathname === '/compress/zstd') {
          response.writeHead(200, {
            'content-type': 'text/plain; charset=utf-8',
            'content-encoding': 'zstd',
            'content-length': String(ZSTD_RESPONSE_BODY.length),
          });
          response.end(ZSTD_RESPONSE_BODY);

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
      })().catch((error: unknown) => {
        response.writeHead(500, {
          'content-type': 'application/json',
        });
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          })
        );
      });
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
