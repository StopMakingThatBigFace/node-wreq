import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('should expose peer certificates in response metadata when requested', async () => {
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
    tlsDebug: {
      peerCertificates: true,
    },
  });

  assert.strictEqual(response.status, 200);
  assert.ok(response.wreq.tls, 'TLS metadata should be exposed when peerCertificates is enabled');
  assert.ok(
    Buffer.isBuffer(response.wreq.tls?.peerCertificate),
    'leaf certificate should be returned as a Buffer'
  );
  assert.ok(
    (response.wreq.tls?.peerCertificateChain?.length ?? 0) >= 1,
    'certificate chain should include at least the leaf certificate'
  );
});

test('should write TLS key log lines to the configured file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'node-wreq-keylog-'));
  const keylogPath = join(directory, 'tls.keys');

  try {
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
      tlsDebug: {
        keylog: {
          path: keylogPath,
        },
      },
    });

    assert.strictEqual(response.status, 200);

    const keylog = readFileSync(keylogPath, 'utf8');

    assert.match(keylog, /^(CLIENT|SERVER)_[A-Z0-9_]+ /m);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('should allow hostname verification to be disabled explicitly', async () => {
  const mismatchedHostUrl = `${getBaseUrl().replace('https://localhost', 'https://mismatch.local')}/protected`;

  await assert.rejects(async () => {
    await fetch(mismatchedHostUrl, {
      browser: 'chrome_137',
      dns: {
        hosts: {
          'mismatch.local': ['127.0.0.1'],
        },
      },
      tlsIdentity: {
        cert: testClientCertPem,
        key: testClientKeyPem,
      },
      ca: {
        cert: testCaPem,
        includeDefaultRoots: false,
      },
    });
  });

  const response = await fetch(mismatchedHostUrl, {
    browser: 'chrome_137',
    dns: {
      hosts: {
        'mismatch.local': ['127.0.0.1'],
      },
    },
    tlsIdentity: {
      cert: testClientCertPem,
      key: testClientKeyPem,
    },
    ca: {
      cert: testCaPem,
      includeDefaultRoots: false,
    },
    tlsDanger: {
      verifyHostname: false,
    },
  });

  assert.strictEqual(response.status, 200);
});

test('should allow certificate verification to be disabled explicitly', async () => {
  await assert.rejects(async () => {
    await fetch(`${getBaseUrl()}/protected`, {
      browser: 'chrome_137',
      tlsIdentity: {
        cert: testClientCertPem,
        key: testClientKeyPem,
      },
    });
  });

  const response = await fetch(`${getBaseUrl()}/protected`, {
    browser: 'chrome_137',
    tlsIdentity: {
      cert: testClientCertPem,
      key: testClientKeyPem,
    },
    tlsDanger: {
      certVerification: false,
    },
  });

  assert.strictEqual(response.status, 200);
});
