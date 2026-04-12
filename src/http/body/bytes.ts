import { Buffer } from 'node:buffer';
import type { BodyInit } from '../../types';

export function toBodyBytes(
  body: BodyInit | null | undefined,
  errorMessage = 'Unsupported body type'
): Uint8Array | null {
  if (body === undefined || body === null) {
    return null;
  }

  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }

  if (body instanceof URLSearchParams) {
    return Buffer.from(body.toString(), 'utf8');
  }

  if (Buffer.isBuffer(body)) {
    return new Uint8Array(body);
  }

  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }

  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }

  throw new TypeError(errorMessage);
}

export function cloneBytes(bytes: Uint8Array | null): Uint8Array | null {
  return bytes ? new Uint8Array(bytes) : null;
}
