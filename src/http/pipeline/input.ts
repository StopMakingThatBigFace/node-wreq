import type { RequestInput, WreqInit } from '../../types';
import { RequestError } from '../../errors';
import { Request } from '../request';

function isGlobalRequest(value: unknown): value is globalThis.Request {
  return typeof globalThis.Request !== 'undefined' && value instanceof globalThis.Request;
}

export async function mergeInputAndInit(
  input: RequestInput,
  init?: WreqInit
): Promise<{
  urlInput: string | URL;
  init: WreqInit;
}> {
  if (typeof input === 'string' || input instanceof URL || input instanceof Request) {
    if (input instanceof Request && input.bodyUsed && init?.body === undefined) {
      throw new TypeError('Request body is already used');
    }

    if (
      input instanceof Request &&
      init?.body === undefined &&
      input.body !== null &&
      ['GET', 'HEAD'].includes((init?.method ?? input.method).toUpperCase())
    ) {
      throw new TypeError('Request with GET/HEAD method cannot have body.');
    }

    return {
      urlInput: input instanceof Request ? input.url : input,
      init:
        input instanceof Request
          ? {
              ...init,
              method: init?.method ?? input.method,
              headers: init?.headers ?? input.headers,
              signal: init?.signal ?? input.signal ?? undefined,
              body: init?.body !== undefined ? init.body : (input._takeBodyInit() ?? undefined),
              multipartBoundary:
                init?.multipartBoundary ??
                (init?.body === undefined ? input._getMultipartBoundary() : undefined),
            }
          : { ...init },
    };
  }

  if (isGlobalRequest(input)) {
    if (input.bodyUsed && init?.body === undefined) {
      throw new TypeError('Request body is already used');
    }

    let body = init?.body;

    if (body === undefined && input.body !== null) {
      const transferred = new globalThis.Request(input, {
        method: init?.method ?? input.method,
      });

      body = transferred.body as ReadableStream<Uint8Array>;
    }

    return {
      urlInput: input.url,
      init: {
        ...init,
        method: init?.method ?? input.method,
        headers: init?.headers ?? Array.from(input.headers.entries()),
        signal: init?.signal ?? input.signal ?? undefined,
        body,
      },
    };
  }

  throw new RequestError('URL is required');
}
