import { AbortError, RequestError, TimeoutError } from '../../errors';
import { nativeRequest } from '../../native/index';
import type { NativeRequestOptions, RequestStats, WreqInit } from '../../types';
import { Response } from '../response';

export async function reportStats(
  callback: WreqInit['onStats'] | undefined,
  stats: RequestStats
): Promise<void> {
  if (!callback) {
    return;
  }

  await callback(stats);
}

export async function dispatchNativeRequest(
  options: NativeRequestOptions,
  startTime: number,
  signal?: AbortSignal | null
): Promise<Response> {
  const nativeResponse = await nativeRequest(options, signal).catch((error: unknown) => {
    if (error instanceof AbortError) {
      throw error;
    }

    const message = String(error);
    const lowered = message.toLowerCase();

    if (lowered.includes('timed out') || lowered.includes('timeout')) {
      throw new TimeoutError(message, { cause: error });
    }

    throw new RequestError(message, { cause: error });
  });

  const responseStart = Date.now();

  return new Response({
    status: nativeResponse.status,
    statusText: nativeResponse.statusText,
    headers: nativeResponse.headers,
    body: nativeResponse.body,
    bodyHandle: nativeResponse.bodyHandle,
    cookies: nativeResponse.cookies,
    setCookies: nativeResponse.setCookies,
    url: nativeResponse.url,
    timings: {
      startTime,
      responseStart,
      wait: responseStart - startTime,
    },
  });
}
