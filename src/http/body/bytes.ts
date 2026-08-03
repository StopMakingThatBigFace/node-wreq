import type {
  BodyInit,
  NativeBodyStreamUpload,
  NativeMultipartStreamPart,
  NativeMultipartUpload,
} from '../../types';
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

export function isBlobBody(body: BodyInit | null | undefined): body is Blob {
  return typeof Blob !== 'undefined' && body instanceof Blob;
}

export function isReadableStreamBody(
  body: BodyInit | null | undefined
): body is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && body instanceof ReadableStream;
}

/** Converts Fetch-compatible iterable bodies into a web ReadableStream. */
export function toReadableStreamBody(
  body: BodyInit | null | undefined
): ReadableStream<Uint8Array> | undefined {
  if (isReadableStreamBody(body)) {
    return body;
  }

  if (
    body === undefined ||
    body === null ||
    typeof body === 'string' ||
    isBlobBody(body) ||
    isFormDataBody(body) ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return undefined;
  }

  if (Symbol.asyncIterator in Object(body)) {
    const iterator = (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();

    return new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          const result = await iterator.next();

          if (result.done) {
            controller.close();
          } else {
            controller.enqueue(result.value);
          }
        },
        cancel: async (reason) => {
          await iterator.return?.(reason);
        },
      },
      { highWaterMark: 0 }
    );
  }

  if (Symbol.iterator in Object(body)) {
    const iterator = (body as Iterable<Uint8Array>)[Symbol.iterator]();

    return new ReadableStream<Uint8Array>(
      {
        pull: (controller) => {
          const result = iterator.next();

          if (result.done) {
            controller.close();
          } else {
            controller.enqueue(result.value);
          }
        },
        cancel: (reason) => {
          iterator.return?.(reason);
        },
      },
      { highWaterMark: 0 }
    );
  }

  return undefined;
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

/** Lazily consumed raw request body backed by a Blob or ReadableStream. */
export class StreamingBody {
  readonly contentLength?: number;
  readonly contentType?: string;
  #source: Blob | ReadableStream<Uint8Array>;
  #stream: ReadableStream<Uint8Array> | null = null;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #used = false;

  constructor(source: Blob | ReadableStream<Uint8Array>) {
    this.#source = source;

    if (isBlobBody(source)) {
      this.contentLength = source.size;
      this.contentType = source.type || undefined;
    }
  }

  get bodyUsed(): boolean {
    return this.#used;
  }

  get locked(): boolean {
    return this.#stream?.locked === true;
  }

  get stream(): ReadableStream<Uint8Array> {
    this.#stream ??= new ReadableStream<Uint8Array>(
      {
        pull: async (controller) => {
          this.#used = true;
          this.#reader ??= this.#openSource().getReader();

          const result = await this.#reader.read();

          if (result.done) {
            controller.close();

            return;
          }

          if (!(result.value instanceof Uint8Array)) {
            throw new TypeError('Request body stream must produce Uint8Array chunks');
          }

          controller.enqueue(result.value);
        },
        cancel: async (reason) => {
          this.#used = true;
          this.#reader ??= this.#openSource().getReader();

          await this.#reader.cancel(reason);
        },
      },
      { highWaterMark: 0 }
    );

    return this.#stream;
  }

  clone(): StreamingBody {
    if (isBlobBody(this.#source)) {
      return new StreamingBody(this.#source.slice(0, this.#source.size, this.#source.type));
    }

    if (this.#used || this.locked || this.#reader) {
      throw new TypeError('Request body is already used');
    }

    const [left, right] = this.#source.tee();

    this.#source = left;

    return new StreamingBody(right);
  }

  transfer(): StreamingBody {
    if (this.#used || this.locked || this.#reader) {
      throw new TypeError('Request body is already used');
    }

    const transferred = new StreamingBody(this.#source);

    this.#used = true;

    return transferred;
  }

  prepareNativeUpload(): NativeBodyStreamUpload {
    const replayableBlob = isBlobBody(this.#source);

    if (!replayableBlob && (this.#used || this.locked)) {
      throw new TypeError('Request body is already used');
    }

    const handle = nativeCreateUpload();
    let started = false;
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    const cancel = (reason?: unknown) => {
      if (cancelled) {
        return;
      }

      cancelled = true;
      void reader?.cancel(reason).catch(() => undefined);
      nativeFinishUpload(handle);
    };

    return {
      body: {
        uploadHandle: handle,
        length: this.contentLength,
      },
      cancel,
      start: async (signal?: AbortSignal | null) => {
        if (started) {
          throw new TypeError('Request body upload has already started');
        }

        started = true;

        if (cancelled || signal?.aborted) {
          cancel(signal?.reason);

          return;
        }

        try {
          if (replayableBlob) {
            this.#used = true;
            reader = (this.#source as Blob).stream().getReader();
          } else {
            reader = this.stream.getReader();
          }

          while (true) {
            if (cancelled || signal?.aborted) {
              cancel(signal?.reason);

              return;
            }

            const result = await reader.read();

            if (result.done) {
              nativeFinishUpload(handle);

              return;
            }

            await nativeWriteUploadChunk(handle, result.value);
          }
        } catch (error) {
          if (cancelled) {
            return;
          }

          try {
            await nativeFailUpload(handle, error);
          } catch {
            // The native request may already have closed its receiver.
          }

          throw error;
        } finally {
          if (reader) {
            try {
              reader.releaseLock();
            } catch {
              // Cancellation may still be settling an outstanding read.
            }
          }
        }
      },
    };
  }

  #openSource(): ReadableStream<Uint8Array> {
    return isBlobBody(this.#source) ? this.#source.stream() : this.#source;
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

  if (isBlobBody(body)) {
    return body.slice(0, body.size, body.type);
  }

  if (isReadableStreamBody(body)) {
    return body;
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
