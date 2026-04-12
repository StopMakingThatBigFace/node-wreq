import { AbortError, HTTPError, RequestError, TimeoutError } from '../../errors';
import type { ResolvedOptions } from '../../types';
import { Request } from '../request';
import { Response } from '../response';

export function isResponseStatusAllowed(
  status: number,
  options: Pick<ResolvedOptions, 'throwHttpErrors' | 'validateStatus'>
): boolean {
  if (options.validateStatus) {
    return options.validateStatus(status);
  }

  if (options.throwHttpErrors) {
    return status >= 200 && status < 300;
  }

  return true;
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function isRequestError(value: unknown): value is RequestError {
  return value instanceof RequestError;
}

export function normalizeRequestError(
  error: unknown,
  request: Request,
  attempt: number,
  response?: Response
): RequestError {
  if (error instanceof TimeoutError || error instanceof AbortError || error instanceof HTTPError) {
    error.request ??= request;
    error.response ??= response;
    error.attempt ??= attempt;

    return error;
  }

  if (isRequestError(error)) {
    error.request ??= request;
    error.response ??= response;
    error.attempt ??= attempt;

    return error;
  }

  if (isError(error)) {
    return new RequestError(error.message, {
      cause: error,
      request,
      response,
      attempt,
    });
  }

  return new RequestError(String(error), {
    cause: error,
    request,
    response,
    attempt,
  });
}

export function inferErrorCode(error: unknown): string | undefined {
  if (error instanceof RequestError && error.code) {
    return error.code;
  }

  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;

    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) {
    return;
  }

  throw new AbortError(undefined, { cause: signal.reason });
}
