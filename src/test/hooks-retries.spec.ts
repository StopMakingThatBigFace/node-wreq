import assert from 'node:assert';
import { describe, test } from 'node:test';
import { Response as WreqResponse, fetch } from '../node-wreq';
import { setupLocalTestServer } from './helpers/local-server';

describe('hooks and retries', () => {
  const { getBaseUrl, retryAttempts } = setupLocalTestServer();

  test('should run init and beforeRequest hooks', async () => {
    const response = await fetch('https://httpbin.org/anything', {
      browser: 'chrome_137',
      timeout: 15000,
      hooks: {
        init: [
          ({ options }) => {
            options.query = { from: 'init-hook' };
          },
        ],
        beforeRequest: [
          ({ request }) => {
            request.headers.set('X-Hook-Header', 'active');
          },
        ],
      },
    });

    const body = await response.json<{
      args: Record<string, string>;
      headers: Record<string, string>;
    }>();

    assert.strictEqual(body.args.from, 'init-hook', 'Init hook should mutate query');
    assert.strictEqual(
      body.headers['X-Hook-Header'],
      'active',
      'beforeRequest should mutate headers'
    );
  });

  test('should allow afterResponse to replace the response', async () => {
    const response = await fetch('https://httpbin.org/status/201', {
      browser: 'chrome_137',
      timeout: 15000,
      hooks: {
        afterResponse: [
          () =>
            new WreqResponse(JSON.stringify({ replaced: true }), {
              status: 299,
              headers: { 'content-type': 'application/json' },
              url: 'https://local/replaced',
            }),
        ],
      },
    });

    assert.strictEqual(response.status, 299, 'afterResponse should replace the response');
    const body = await response.json<{ replaced: boolean }>();

    assert.strictEqual(body.replaced, true, 'Replaced response body should be returned');
  });

  test('should allow beforeError to rewrite thrown errors', async () => {
    await assert.rejects(
      async () => {
        await fetch('https://httpbin.org/status/418', {
          browser: 'chrome_137',
          timeout: 15000,
          throwHttpErrors: true,
          hooks: {
            beforeError: [
              ({ error }) => {
                error.message = `hooked: ${error.message}`;

                return error;
              },
            ],
          },
        });
      },
      (error: unknown) =>
        error instanceof Error && error.message.includes('hooked: Request failed with status 418'),
      'beforeError should be able to rewrite the final error'
    );
  });

  test('should run beforeRetry hooks and retry retriable responses', async () => {
    retryAttempts.set('status-retry', 0);
    const hookAttempts: number[] = [];
    const response = await fetch(`${getBaseUrl()}/retry?key=status-retry&failCount=2`, {
      retry: {
        limit: 2,
        statusCodes: [503],
        backoff: () => 0,
      },
      hooks: {
        beforeRetry: [
          ({ attempt, response: retryResponse }) => {
            hookAttempts.push(attempt);
            assert.strictEqual(retryResponse?.status, 503);
          },
        ],
      },
    });

    assert.strictEqual(response.status, 200, 'request should eventually succeed');
    assert.deepStrictEqual(
      hookAttempts,
      [2, 3],
      'beforeRetry should run before each retry attempt'
    );

    const body = await response.json<{ attempt: number; retried: boolean }>();

    assert.strictEqual(body.attempt, 3, 'third attempt should be the successful response');
    assert.strictEqual(body.retried, true, 'server should observe retries');
  });

  test('should expose response timings and onStats callback data', async () => {
    let capturedStats:
      | {
          attempt: number;
          wait: number;
          status?: number;
        }
      | undefined;

    const response = await fetch(`${getBaseUrl()}/timings/delay`, {
      onStats: ({ attempt, timings, response: statsResponse }) => {
        capturedStats = {
          attempt,
          wait: timings.wait,
          status: statsResponse?.status,
        };
      },
    });

    assert.ok(response.wreq.timings, 'response should expose timings');
    assert.ok((response.wreq.timings?.wait ?? 0) >= 20, 'timings should record server wait time');
    assert.strictEqual(capturedStats?.attempt, 1);
    assert.strictEqual(capturedStats?.status, 200);
    assert.ok((capturedStats?.wait ?? 0) >= 20, 'onStats should receive request timings');
  });
});
