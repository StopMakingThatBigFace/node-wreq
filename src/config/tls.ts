import { Buffer } from 'node:buffer';
import type {
  CertificateAuthority,
  NativeCertificateAuthority,
  NativeTlsDanger,
  NativeTlsDebug,
  NativeTlsIdentity,
  TlsDangerOptions,
  TlsBinaryInput,
  TlsDataInput,
  TlsDebugOptions,
  TlsIdentity,
} from '../types';

function toBuffer(input: TlsDataInput | TlsBinaryInput): Buffer {
  if (Buffer.isBuffer(input)) {
    return Buffer.from(input);
  }

  if (typeof input === 'string') {
    return Buffer.from(input, 'utf8');
  }

  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }

  return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

export function normalizeTlsIdentity(identity?: TlsIdentity): NativeTlsIdentity | undefined {
  if (!identity) {
    return undefined;
  }

  if ('pfx' in identity) {
    return {
      pfx: toBuffer(identity.pfx),
      passphrase: identity.passphrase,
    };
  }

  return {
    cert: toBuffer(identity.cert),
    key: toBuffer(identity.key),
  };
}

export function normalizeCertificateAuthority(
  authority?: CertificateAuthority
): NativeCertificateAuthority | undefined {
  if (!authority) {
    return undefined;
  }

  const certs = (Array.isArray(authority.cert) ? authority.cert : [authority.cert]).map(toBuffer);

  if (certs.length === 0) {
    throw new TypeError('ca.cert must include at least one certificate');
  }

  return {
    certs,
    includeDefaultRoots: authority.includeDefaultRoots ?? false,
  };
}

export function normalizeTlsDebug(debug?: TlsDebugOptions): NativeTlsDebug | undefined {
  if (!debug) {
    return undefined;
  }

  let keylogFromEnv: boolean | undefined;
  let keylogPath: string | undefined;

  if (debug.keylog !== undefined) {
    if (debug.keylog === true) {
      keylogFromEnv = true;
    } else if (typeof debug.keylog === 'object' && debug.keylog !== null) {
      if (typeof debug.keylog.path !== 'string') {
        throw new TypeError('tlsDebug.keylog.path must be a non-empty string');
      }

      const path = debug.keylog.path.trim();

      if (!path) {
        throw new TypeError('tlsDebug.keylog.path must be a non-empty string');
      }

      keylogPath = path;
    } else {
      throw new TypeError('tlsDebug.keylog must be true or an object with a path');
    }
  }

  const normalized: NativeTlsDebug = {};

  if (debug.peerCertificates !== undefined) {
    normalized.peerCertificates = debug.peerCertificates;
  }

  if (keylogFromEnv) {
    normalized.keylogFromEnv = true;
  }

  if (keylogPath !== undefined) {
    normalized.keylogPath = keylogPath;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeTlsDanger(danger?: TlsDangerOptions): NativeTlsDanger | undefined {
  if (!danger) {
    return undefined;
  }

  const normalized: NativeTlsDanger = {};

  if (danger.certVerification !== undefined) {
    normalized.certVerification = danger.certVerification;
  }

  if (danger.verifyHostname !== undefined) {
    normalized.verifyHostname = danger.verifyHostname;
  }

  if (danger.sni !== undefined) {
    normalized.sni = danger.sni;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
