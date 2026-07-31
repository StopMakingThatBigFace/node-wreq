import type { NativeRequestOptions, NativeResponse } from '../types';
import { Buffer } from 'node:buffer';
import { AbortError } from '../errors';
import { getBinding } from './binding';

export async function nativeRequest(
  options: NativeRequestOptions,
  signal?: AbortSignal | null
): Promise<NativeResponse> {
  if (signal?.aborted) {
    options.multipartUpload?.cancel(signal.reason);
    throw new AbortError(undefined, { cause: signal.reason });
  }

  const { multipartUpload, ...nativeOptions } = options;
  let task: ReturnType<ReturnType<typeof getBinding>['request']>;

  try {
    task = getBinding().request(nativeOptions);
  } catch (error) {
    multipartUpload?.cancel(error);
    throw error;
  }

  if (multipartUpload) {
    // Upload errors are forwarded through the native body stream so the request
    // retains the original failure instead of being replaced with a generic abort.
    void multipartUpload.start(signal).catch(() => undefined);
  }

  if (!signal) {
    try {
      return await task.promise;
    } finally {
      multipartUpload?.cancel();
    }
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
      multipartUpload?.cancel(signal.reason);
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
        multipartUpload?.cancel();
        resolve(response);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        multipartUpload?.cancel(error);
        reject(error);
      }
    );
  });
}

export function nativeCreateUpload(): number {
  return getBinding().createUpload();
}

export async function nativeWriteUploadChunk(handle: number, chunk: Uint8Array): Promise<void> {
  await getBinding().writeUploadChunk(
    handle,
    Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  );
}

export async function nativeFailUpload(handle: number, reason: unknown): Promise<void> {
  const message = reason instanceof Error ? reason.message : String(reason ?? 'Upload failed');

  await getBinding().failUpload(handle, message);
}

export function nativeFinishUpload(handle: number): boolean {
  return getBinding().finishUpload(handle);
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

export function nativeReleaseClient(clientId: number): boolean {
  return getBinding().releaseClient(clientId);
}

export function nativeForbidBodyRecycle(handle: number): boolean {
  return getBinding().forbidBodyRecycle(handle);
}
