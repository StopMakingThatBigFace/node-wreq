import { Buffer } from 'node:buffer';
import type { BodyInit } from '../../types';

const FORM_DATA_PLACEHOLDER_URL = 'http://node-wreq.invalid/';

function isFileValue(value: string | Blob): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

export function isFormDataBody(body: BodyInit | null | undefined): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

export function cloneFormData(body: FormData): FormData {
  const cloned = new FormData();

  for (const [name, value] of body.entries()) {
    if (typeof value === 'string') {
      cloned.append(name, value);

      continue;
    }

    if (isFileValue(value)) {
      cloned.append(name, value, value.name);

      continue;
    }

    cloned.append(name, value);
  }

  return cloned;
}

export function createMultipartRequest(body: FormData): globalThis.Request {
  if (typeof globalThis.Request === 'undefined') {
    throw new TypeError('multipart/form-data requests require global Request support');
  }

  return new globalThis.Request(FORM_DATA_PLACEHOLDER_URL, {
    method: 'POST',
    body,
  });
}

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

export function cloneBodyInit(body: BodyInit | null | undefined): BodyInit | null {
  if (body === undefined || body === null) {
    return null;
  }

  if (isFormDataBody(body)) {
    return cloneFormData(body);
  }

  if (typeof body === 'string') {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return new URLSearchParams(body);
  }

  const bytes = toBodyBytes(body);

  return bytes ? cloneBytes(bytes) : null;
}

export function cloneBytes(bytes: Uint8Array | null): Uint8Array | null {
  return bytes ? new Uint8Array(bytes) : null;
}
