import type { BodyInit, NativeMultipartStreamPart, NativeMultipartUpload } from '../../types';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import {
  nativeCreateUpload,
  nativeFailUpload,
  nativeFinishUpload,
  nativeWriteUploadChunk,
} from '../../native';

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
      cloned.append(name, value);

      continue;
    }

    cloned.append(name, value);
  }

  return cloned;
}

const WEBKIT_BOUNDARY_PREFIX = '----WebKitFormBoundary';
const BOUNDARY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789AB';
const BOUNDARY_PATTERN = /^[0-9A-Za-z'()+_,./:=?-]{1,70}$/;

function generateWebKitBoundary(): string {
  const random = randomBytes(16);
  let suffix = '';

  for (const byte of random) {
    suffix += BOUNDARY_ALPHABET[byte & 0x3f];
  }

  return `${WEBKIT_BOUNDARY_PREFIX}${suffix}`;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\r\n');
}

function escapeMultipartParameter(value: string): string {
  return normalizeLineEndings(value)
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/"/g, '%22');
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
    private readonly formDataValue: FormData,
    private readonly targetBoundary: string
  ) {
    this.contentType = `multipart/form-data; boundary=${targetBoundary}`;
  }

  clone(): MultipartBody {
    return new MultipartBody(cloneFormData(this.formDataValue), this.targetBoundary);
  }

  withBoundary(boundary: string): MultipartBody {
    validateMultipartBoundary(boundary);

    return new MultipartBody(cloneFormData(this.formDataValue), boundary);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const request = new globalThis.Request(FORM_DATA_PLACEHOLDER_URL, {
      method: 'POST',
      body: cloneFormData(this.formDataValue),
    });

    const contentType = request.headers.get('content-type') ?? '';
    const sourceBoundary = /boundary=(?:"([^"]+)"|([^;]+))/i
      .exec(contentType)
      ?.slice(1)
      .find(Boolean);

    if (!sourceBoundary) {
      throw new TypeError('Failed to determine the generated multipart boundary');
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    const rewritten = replaceBoundaryBytes(bytes, sourceBoundary, this.targetBoundary);

    return Uint8Array.from(rewritten).buffer;
  }

  async formData(): Promise<FormData> {
    const request = new globalThis.Request(FORM_DATA_PLACEHOLDER_URL, {
      method: 'POST',
      body: cloneFormData(this.formDataValue),
    });

    return request.formData();
  }

  cloneFormData(): FormData {
    return cloneFormData(this.formDataValue);
  }

  get boundary(): string {
    return this.targetBoundary;
  }

  prepareNativeUpload(): NativeMultipartUpload {
    const sources: Array<{ blob: Blob; handle: number }> = [];
    const parts: NativeMultipartUpload['body']['parts'] = [];

    try {
      for (const [rawName, value] of this.formDataValue.entries()) {
        const name = escapeMultipartParameter(rawName);

        if (typeof value === 'string') {
          parts.push({
            kind: 'text',
            name,
            value: normalizeLineEndings(value),
          });

          continue;
        }

        const handle = nativeCreateUpload();
        const streamPart: NativeMultipartStreamPart = {
          kind: 'stream',
          name,
          fileName: escapeMultipartParameter(value.name),
          mimeType: value.type || 'application/octet-stream',
          length: value.size,
          uploadHandle: handle,
        };

        sources.push({ blob: value, handle });
        parts.push(streamPart);
      }
    } catch (error) {
      for (const source of sources) {
        nativeFinishUpload(source.handle);
      }

      throw error;
    }

    let started = false;
    let cancelled = false;
    const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();

    const cancel = () => {
      if (cancelled) {
        return;
      }

      cancelled = true;

      for (const reader of readers) {
        void reader.cancel().catch(() => undefined);
      }

      for (const source of sources) {
        nativeFinishUpload(source.handle);
      }
    };

    return {
      body: {
        boundary: this.targetBoundary,
        parts,
      },
      cancel,
      async start(signal?: AbortSignal | null): Promise<void> {
        if (started) {
          throw new TypeError('Multipart upload has already started');
        }

        started = true;

        for (const source of sources) {
          if (cancelled || signal?.aborted) {
            cancel();

            return;
          }

          let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

          try {
            reader = source.blob.stream().getReader();
            readers.add(reader);

            while (true) {
              if (cancelled || signal?.aborted) {
                break;
              }

              const result = await reader.read();

              if (result.done) {
                break;
              }

              await nativeWriteUploadChunk(source.handle, result.value);
            }

            nativeFinishUpload(source.handle);
          } catch (error) {
            if (cancelled) {
              return;
            }

            try {
              await nativeFailUpload(source.handle, error);
            } catch {
              // The native request may already have closed its receiver.
            }

            cancel();
            throw error;
          } finally {
            if (reader) {
              readers.delete(reader);

              try {
                reader.releaseLock();
              } catch {
                // Cancellation may still be settling an outstanding read.
              }
            }
          }
        }
      },
    };
  }
}

export function createMultipartRequest(body: FormData, boundary?: string): MultipartBody {
  if (typeof globalThis.Request === 'undefined') {
    throw new TypeError('multipart/form-data requests require global Request support');
  }

  const targetBoundary = boundary ?? generateWebKitBoundary();

  validateMultipartBoundary(targetBoundary);

  return new MultipartBody(cloneFormData(body), targetBoundary);
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
