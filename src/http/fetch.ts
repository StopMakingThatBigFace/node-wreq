import { HTTPError, RequestError } from '../errors';
import {
  runAfterResponseHooks,
  runBeforeErrorHooks,
  runBeforeRedirectHooks,
  runBeforeRequestHooks,
  runBeforeRetryHooks,
  runInitHooks,
} from '../hooks';
import { normalizeMethod } from '../native/index';
import type { RedirectEntry, RequestInput, RetryDecisionContext, WreqInit } from '../types';
import { loadCookiesIntoRequest, persistResponseCookies } from './pipeline/cookies';
import { dispatchNativeRequest, reportStats } from './pipeline/dispatch';
import { isResponseStatusAllowed, normalizeRequestError, throwIfAborted } from './pipeline/errors';
import { mergeInputAndInit } from './pipeline/input';
import { buildNativeRequest, createRequest, resolveOptions } from './pipeline/options';
import {
  finalizeResponse,
  isRedirectResponse,
  resolveRedirectLocation,
  rewriteRedirectMethodAndBody,
  stripRedirectSensitiveHeaders,
  toRedirectEntry,
} from './pipeline/redirects';
import { runRetryDelay, shouldRetryRequest } from './pipeline/retries';

export async function fetch(input: RequestInput, init?: WreqInit) {
  const merged = await mergeInputAndInit(input, init);
  const state = (merged.init.context ? { ...merged.init.context } : {}) as Record<string, unknown>;

  await runInitHooks(merged.init.hooks, {
    input,
    options: merged.init,
    state,
  });

  const options = resolveOptions(merged.init);
  let request = createRequest(merged.urlInput, options);
  const redirectChain: RedirectEntry[] = [];
  const visitedRedirectTargets = new Set<string>([request.url]);
  let attempt = 1;

  while (true) {
    const startTime = Date.now();

    try {
      throwIfAborted(options.signal);

      if (options.cookieJar) {
        request.headers.delete('cookie');
      }

      await loadCookiesIntoRequest(options.cookieJar, request);

      const shortCircuit = await runBeforeRequestHooks(options.hooks, {
        request,
        options,
        attempt,
        state,
      });

      let response =
        shortCircuit ??
        (await dispatchNativeRequest(
          await buildNativeRequest(request, options),
          startTime,
          options.signal
        ));

      if (shortCircuit) {
        response.setTimings({
          startTime,
          responseStart: startTime,
          wait: 0,
          endTime: startTime,
          total: 0,
        });
      }

      response = await runAfterResponseHooks(options.hooks, {
        request,
        options,
        attempt,
        state,
        response,
      });

      await reportStats(options.onStats, {
        request,
        attempt,
        timings: response.wreq.timings ?? {
          startTime,
          responseStart: startTime,
          wait: 0,
        },
        response,
      });

      await persistResponseCookies(options.cookieJar, request.url, response);

      if (isRedirectResponse(response)) {
        if (options.redirect === 'manual') {
          return finalizeResponse(response, redirectChain);
        }

        if (options.redirect === 'error') {
          throw new RequestError(`Redirect encountered for ${request.url}`, {
            code: 'ERR_REDIRECT',
            request,
            response,
            attempt,
          });
        }

        if (redirectChain.length >= options.maxRedirects) {
          throw new RequestError(`Maximum redirects exceeded: ${options.maxRedirects}`, {
            code: 'ERR_TOO_MANY_REDIRECTS',
            request,
            response,
            attempt,
          });
        }

        const nextUrl = resolveRedirectLocation(response, request.url);

        if (visitedRedirectTargets.has(nextUrl)) {
          throw new RequestError(`Redirect loop detected for ${nextUrl}`, {
            code: 'ERR_REDIRECT_LOOP',
            request,
            response,
            attempt,
          });
        }

        const rewritten = rewriteRedirectMethodAndBody(
          normalizeMethod(request.method),
          response.status,
          (await request._cloneBodyBytes()) ?? undefined
        );

        const nextRequest = request._replace({
          url: nextUrl,
          method: rewritten.method,
          body: rewritten.body,
        });

        stripRedirectSensitiveHeaders(
          nextRequest.headers,
          request.url,
          nextUrl,
          rewritten.bodyDropped
        );

        if (options.cookieJar) {
          nextRequest.headers.delete('cookie');
        }

        const redirectEntry = toRedirectEntry(request.url, response, nextUrl, nextRequest.method);

        await runBeforeRedirectHooks(options.hooks, {
          request: nextRequest,
          options,
          attempt,
          state,
          response,
          redirectCount: redirectChain.length + 1,
          nextUrl,
          nextMethod: normalizeMethod(nextRequest.method),
          redirectChain: [...redirectChain, redirectEntry],
        });

        redirectChain.push({
          ...redirectEntry,
          toUrl: nextRequest.url,
          method: normalizeMethod(nextRequest.method),
        });

        visitedRedirectTargets.add(nextRequest.url);
        request = nextRequest;
        continue;
      }

      const nextAttempt = attempt + 1;
      const retryContext: RetryDecisionContext = {
        request,
        options,
        attempt: nextAttempt,
        state,
        response,
      };

      if (await shouldRetryRequest(retryContext, options.retry)) {
        const retryError = new HTTPError(
          `Request failed with status ${response.status}`,
          response.status,
          {
            request,
            response,
            attempt,
          }
        );

        await runBeforeRetryHooks(options.hooks, {
          request,
          options,
          attempt: nextAttempt,
          state,
          error: retryError,
          response,
        });

        await runRetryDelay({ ...retryContext, error: retryError }, options.retry);
        attempt = nextAttempt;
        continue;
      }

      if (!isResponseStatusAllowed(response.status, options)) {
        throw new HTTPError(`Request failed with status ${response.status}`, response.status, {
          request,
          response,
          attempt,
        });
      }

      return finalizeResponse(response, redirectChain);
    } catch (error: unknown) {
      const normalizedError = normalizeRequestError(error, request, attempt);
      const errorEndTime = Date.now();

      await reportStats(options.onStats, {
        request,
        attempt,
        timings: {
          startTime,
          responseStart: errorEndTime,
          wait: errorEndTime - startTime,
          endTime: errorEndTime,
          total: errorEndTime - startTime,
        },
        error: normalizedError,
        response: normalizedError.response,
      });

      const nextAttempt = attempt + 1;
      const retryContext: RetryDecisionContext = {
        request,
        options,
        attempt: nextAttempt,
        state,
        error: normalizedError,
        response: normalizedError.response,
      };

      if (await shouldRetryRequest(retryContext, options.retry)) {
        await runBeforeRetryHooks(options.hooks, {
          request,
          options,
          attempt: nextAttempt,
          state,
          error: normalizedError,
          response: normalizedError.response,
        });

        await runRetryDelay(retryContext, options.retry);
        attempt = nextAttempt;
        continue;
      }

      const finalError = await runBeforeErrorHooks(options.hooks, {
        request,
        options,
        attempt,
        state,
        error: normalizedError,
      });

      throw finalError;
    }
  }
}
