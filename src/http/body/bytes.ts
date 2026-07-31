import type { BodyInit } from '../../types';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

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

const WEBKIT_BOUNDARY_PREFIX = '----WebKitFormBoundary';
const BOUNDARY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const BOUNDARY_PATTERN = /^[0-9A-Za-z'()+_,./:=?-]{1,70}$/;

function generateWebKitBoundary(): string {
  const random = randomBytes(16);
  let suffix = '';

  for (const byte of random) {
    suffix += BOUNDARY_ALPHABET[byte % BOUNDARY_ALPHABET.length];
  }

  return `${WEBKIT_BOUNDARY_PREFIX}${suffix}`;
}

function validateMultipartBoundary(boundary: string): void {
  if (!BOUNDARY_PATTERN.test(boundary)) {
    throw new TypeError(
      'multipartBoundary must contain 1-70 ASCII boundary characters without spaces'
    );
  }
}

function findSequence(source: Uint8Array, needle: Uint8Array, offset: number): number {
  outer: for (let index = offset; index <= source.length - needle.length; index += 1) {
    for (let part = 0; part < needle.length; part += 1) {
      if (source[index + part] !== needle[part]) {
        continue outer;
      }
    }

    return index;
  }

  return -1;
}

function replaceBoundaryBytes(
  source: Uint8Array,
  sourceBoundary: string,
  targetBoundary: string
): Uint8Array {
  if (sourceBoundary === targetBoundary) {
    return source;
  }

  const needle = Buffer.from(`--${sourceBoundary}`);
  const replacement = Buffer.from(`--${targetBoundary}`);
  const matches: number[] = [];
  let offset = 0;

  while (offset <= source.length - needle.length) {
    const match = findSequence(source, needle, offset);

    if (match < 0) {
      break;
    }

    matches.push(match);
    offset = match + needle.length;
  }

  if (matches.length === 0) {
    throw new TypeError('Failed to locate the generated multipart boundary in the request body');
  }

  const output = new Uint8Array(
    source.length + matches.length * (replacement.length - needle.length)
  );

  let sourceOffset = 0;
  let outputOffset = 0;

  for (const match of matches) {
    output.set(source.subarray(sourceOffset, match), outputOffset);
    outputOffset += match - sourceOffset;
    output.set(replacement, outputOffset);
    outputOffset += replacement.length;
    sourceOffset = match + needle.length;
  }

  output.set(source.subarray(sourceOffset), outputOffset);

  return output;
}

/** Lazily encoded multipart body with a browser-compatible boundary. */
export class MultipartBody {
  readonly contentType: string;

  constructor(
    private readonly request: globalThis.Request,
    private readonly sourceBoundary: string,
    private readonly targetBoundary: string
  ) {
    this.contentType = `multipart/form-data; boundary=${targetBoundary}`;
  }

  clone(): MultipartBody {
    return new MultipartBody(this.request.clone(), this.sourceBoundary, this.targetBoundary);
  }

  withBoundary(boundary: string): MultipartBody {
    validateMultipartBoundary(boundary);

    return new MultipartBody(this.request.clone(), this.sourceBoundary, boundary);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = new Uint8Array(await this.request.clone().arrayBuffer());
    const rewritten = replaceBoundaryBytes(bytes, this.sourceBoundary, this.targetBoundary);

    return Uint8Array.from(rewritten).buffer;
  }

  async formData(): Promise<FormData> {
    return this.request.clone().formData();
  }
}

export function createMultipartRequest(body: FormData, boundary?: string): MultipartBody {
  if (typeof globalThis.Request === 'undefined') {
    throw new TypeError('multipart/form-data requests require global Request support');
  }

  const request = new globalThis.Request(FORM_DATA_PLACEHOLDER_URL, {
    method: 'POST',
    body,
  });

  const contentType = request.headers.get('content-type') ?? '';
  const sourceBoundary = /boundary=(?:"([^"]+)"|([^;]+))/i
    .exec(contentType)
    ?.slice(1)
    .find(Boolean);

  if (!sourceBoundary) {
    throw new TypeError('Failed to determine the generated multipart boundary');
  }

  const targetBoundary = boundary ?? generateWebKitBoundary();

  validateMultipartBoundary(targetBoundary);

  return new MultipartBody(request, sourceBoundary, targetBoundary);
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
