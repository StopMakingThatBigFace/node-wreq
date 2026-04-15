import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import { after, before } from 'node:test';
import type { TLSSocket } from 'node:tls';
import { testCaPem, testServerCertPem, testServerKeyPem } from '../fixtures/mtls';

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json',
  });
  response.end(JSON.stringify(body));
}

export function setupMtlsTestServer() {
  let baseUrl = '';
  let server: Server | undefined;

  before(async () => {
    server = createServer(
      {
        key: testServerKeyPem,
        cert: testServerCertPem,
        ca: testCaPem,
        requestCert: true,
        rejectUnauthorized: true,
      },
      (request: IncomingMessage, response: ServerResponse) => {
        const url = new URL(request.url ?? '/', 'https://localhost');

        if (url.pathname === '/protected') {
          const socket = request.socket as TLSSocket;
          const peerCertificate = socket.getPeerCertificate();

          sendJson(response, 200, {
            authorized: socket.authorized,
            subject: peerCertificate.subject?.CN ?? null,
          });

          return;
        }

        sendJson(response, 404, { path: url.pathname });
      }
    );

    await new Promise<void>((resolve) => {
      server?.listen(0, '127.0.0.1', () => {
        const address = server?.address();

        if (!address || typeof address === 'string') {
          throw new Error('Failed to bind mTLS test server');
        }

        baseUrl = `https://localhost:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
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
      return baseUrl;
    },
  };
}
