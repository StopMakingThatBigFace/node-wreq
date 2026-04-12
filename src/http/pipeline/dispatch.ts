import { RequestError, TimeoutError } from '../../errors';
import { nativeRequest } from '../../native';
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
  startTime: number
): Promise<Response> {
  const nativeResponse = await nativeRequest(options).catch((error: unknown) => {
    const message = String(error);
    const lowered = message.toLowerCase();

    if (lowered.includes('timed out') || lowered.includes('timeout')) {
      throw new TimeoutError(message, { cause: error });
    }

    throw new RequestError(message, { cause: error });
  });

  const responseStart = Date.now();

  return new Response({
    ...nativeResponse,
    timings: {
      startTime,
      responseStart,
      wait: responseStart - startTime,
    },
  });
}
