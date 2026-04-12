import { normalizeMethod } from '../../native';
import type { ResolvedRetryOptions, RetryDecisionContext } from '../../types';
import { inferErrorCode } from './errors';

async function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function shouldRetryRequest(
  context: RetryDecisionContext,
  retry: ResolvedRetryOptions
): Promise<boolean> {
  if (context.attempt > retry.limit + 1) {
    return false;
  }

  if (!retry.methods.includes(normalizeMethod(context.request.method))) {
    return false;
  }

  if (context.response) {
    if (!retry.statusCodes.includes(context.response.status)) {
      return false;
    }
  } else {
    const code = inferErrorCode(context.error);

    if (!code || !retry.errorCodes.includes(code)) {
      return false;
    }
  }

  if (!retry.shouldRetry) {
    return true;
  }

  return retry.shouldRetry(context);
}

export async function runRetryDelay(
  context: RetryDecisionContext,
  retry: ResolvedRetryOptions
): Promise<void> {
  if (!retry.backoff) {
    return;
  }

  const delay = await retry.backoff(context);

  await sleep(delay);
}
