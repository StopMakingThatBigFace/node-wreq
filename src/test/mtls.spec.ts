import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { fetch } from '../node-wreq';
import {
  testCaPem,
  testClientCertPem,
  testClientIdentityPassphrase,
  testClientIdentityPfxBase64,
  testClientKeyPem,
} from './fixtures/mtls';
import { setupMtlsTestServer } from './helpers/mtls-server';

const { getBaseUrl } = setupMtlsTestServer();

test('should authenticate with a PEM client certificate for mTLS', async () => {
  const response = await fetch(`${getBaseUrl()}/protected`, {
    browser: 'chrome_137',
    tlsIdentity: {
      cert: testClientCertPem,
      key: testClientKeyPem,
    },
    ca: {
      cert: testCaPem,
      includeDefaultRoots: false,
    },
  });

  assert.strictEqual(response.status, 200);

  const body = await response.json<{ authorized: boolean; subject: string | null }>();

  assert.strictEqual(body.authorized, true);
  assert.strictEqual(body.subject, 'node-wreq Test Client');
});

test('should authenticate with a PKCS#12 client certificate for mTLS', async () => {
  const response = await fetch(`${getBaseUrl()}/protected`, {
    browser: 'chrome_137',
    tlsIdentity: {
      pfx: Buffer.from(testClientIdentityPfxBase64, 'base64'),
      passphrase: testClientIdentityPassphrase,
    },
    ca: {
      cert: testCaPem,
      includeDefaultRoots: false,
    },
  });

  assert.strictEqual(response.status, 200);
});

test('should reject requests to an mTLS endpoint without a client certificate', async () => {
  await assert.rejects(async () => {
    await fetch(`${getBaseUrl()}/protected`, {
      browser: 'chrome_137',
      ca: {
        cert: testCaPem,
        includeDefaultRoots: false,
      },
    });
  });
});
