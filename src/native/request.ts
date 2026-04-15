import { AbortError } from '../errors';
import type { NativeRequestOptions, NativeResponse } from '../types';
import { getBinding } from './binding';

export async function nativeRequest(
  options: NativeRequestOptions,
  signal?: AbortSignal | null
): Promise<NativeResponse> {
  if (signal?.aborted) {
    throw new AbortError(undefined, { cause: signal.reason });
  }

  const task = getBinding().request(options);

  if (!signal) {
    return task.promise;
  }

  return new Promise<NativeResponse>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      getBinding().cancelRequest(task.handle);
      reject(new AbortError(undefined, { cause: signal.reason }));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    task.promise.then(
      (response) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(response);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      }
    );
  });
}

export async function nativeReadBodyChunk(
  handle: number,
  size?: number
): Promise<{
  chunk: Uint8Array;
  done: boolean;
}> {
  return getBinding().readBodyChunk(handle, size);
}

export function nativeCancelBody(handle: number): boolean {
  return getBinding().cancelBody(handle);
}
