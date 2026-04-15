import { request as httpRequest, createServer, type Server } from 'node:http';
import { after, before } from 'node:test';

export function setupProxyTestServer() {
  let proxyBaseUrl = '';
  let proxyServer: Server | undefined;
  let proxiedRequests = 0;

  before(async () => {
    proxyServer = createServer((request, response) => {
      proxiedRequests += 1;

      const targetUrl = new URL(request.url ?? '/');
      const upstream = httpRequest(
        targetUrl,
        {
          method: request.method,
          headers: request.headers,
        },
        (upstreamResponse) => {
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        }
      );

      request.pipe(upstream);
      upstream.on('error', (error: Error) => {
        response.writeHead(502, {
          'content-type': 'application/json',
        });
        response.end(JSON.stringify({ error: error.message }));
      });
    });

    await new Promise<void>((resolve) => {
      proxyServer?.listen(0, '127.0.0.1', () => {
        const address = proxyServer?.address();

        if (!address || typeof address === 'string') {
          throw new Error('Failed to bind proxy test server');
        }

        proxyBaseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      proxyServer?.close((error) => {
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
      return proxyBaseUrl;
    },
    getHits() {
      return proxiedRequests;
    },
    resetHits() {
      proxiedRequests = 0;
    },
  };
}
