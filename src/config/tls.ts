import { Buffer } from 'node:buffer';
import type {
  CertificateAuthority,
  NativeCertificateAuthority,
  NativeTlsIdentity,
  TlsBinaryInput,
  TlsDataInput,
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
