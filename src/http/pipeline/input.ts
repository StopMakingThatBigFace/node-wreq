import { Buffer } from 'node:buffer';
import { RequestError } from '../../errors';
import type { RequestInput, WreqInit } from '../../types';
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

    return {
      urlInput: input instanceof Request ? input.url : input,
      init:
        input instanceof Request
          ? {
              ...init,
              method: init?.method ?? input.method,
              headers: init?.headers ?? input.headers,
              signal: init?.signal ?? input.signal ?? undefined,
              body: init?.body !== undefined ? init.body : (input._cloneBodyBytes() ?? undefined),
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
      body = Buffer.from(await input.arrayBuffer());
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
