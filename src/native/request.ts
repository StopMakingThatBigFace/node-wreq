import type { NativeRequestOptions, NativeResponse } from '../types';
import { getBinding } from './binding';

export async function nativeRequest(options: NativeRequestOptions): Promise<NativeResponse> {
  return getBinding().request(options);
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

export async function nativeReadBodyAll(handle: number): Promise<Uint8Array> {
  return getBinding().readBodyAll(handle);
}

export function nativeCancelBody(handle: number): boolean {
  return getBinding().cancelBody(handle);
}
