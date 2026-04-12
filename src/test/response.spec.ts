import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';
import { TextDecoder } from 'node:util';
import { Response as WreqResponse, fetch } from '../node-wreq';
import { setupLocalTestServer } from './helpers/local-server';

describe('response behavior', () => {
  const { getBaseUrl } = setupLocalTestServer();

  test('should expose fetch-style response body lifecycle', async () => {
    const response = new WreqResponse(JSON.stringify({ streamed: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      url: 'https://local/body',
    });

    assert.strictEqual(response.bodyUsed, false, 'body should start unused');

    const bodyStream = response.body;

    assert.ok(bodyStream, 'body should expose a stream');
    assert.strictEqual(response.bodyUsed, false, 'accessing body should not mark it used');

    const reader = bodyStream?.getReader();
    const chunks: Uint8Array[] = [];

    while (reader) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      assert.strictEqual(response.bodyUsed, true, 'reading the stream should mark it used');
      chunks.push(result.value);
    }

    const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));

    assert.strictEqual(
      new TextDecoder().decode(merged),
      JSON.stringify({ streamed: true }),
      'body stream should contain the response payload'
    );

    await assert.rejects(
      async () => {
        await response.text();
      },
      (error: unknown) => error instanceof TypeError && error.message.includes('already been read'),
      'consumers should reject after the body is used'
    );
  });

  test('should support cloning buffered responses before they are read', async () => {
    const response = new WreqResponse(JSON.stringify({ cloned: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      url: 'https://local/clone',
    });

    const initialBody = response.body;

    assert.ok(initialBody, 'response should expose a body stream before cloning');
    assert.strictEqual(response.bodyUsed, false, 'getting the body should not disturb it');

    const cloned = response.clone();

    assert.notStrictEqual(cloned, response, 'clone should return a new response instance');
    assert.notStrictEqual(
      response.body,
      initialBody,
      'clone should replace the original body branch'
    );
    assert.throws(
      () => initialBody?.getReader(),
      (error: unknown) => error instanceof TypeError && error.message.includes('locked'),
      'the pre-clone body stream should no longer be readable after tee()'
    );

    const [left, right] = await Promise.all([response.text(), cloned.text()]);

    assert.strictEqual(left, JSON.stringify({ cloned: true }));
    assert.strictEqual(right, JSON.stringify({ cloned: true }));
  });

  test('should reject clone and convenience readers while the body stream is locked', async () => {
    const response = new WreqResponse('locked', {
      status: 200,
      url: 'https://local/locked',
    });

    const bodyStream = response.body;

    assert.ok(bodyStream, 'response should expose a body stream');

    const reader = bodyStream.getReader();

    assert.strictEqual(response.bodyUsed, false, 'locking the stream should not mark it used');

    assert.throws(
      () => response.clone(),
      (error: unknown) => error instanceof TypeError && error.message.includes('consumed'),
      'clone should reject while the body stream is locked'
    );

    await assert.rejects(
      async () => response.text(),
      (error: unknown) => error instanceof TypeError && error.message.includes('already been read'),
      'convenience readers should reject while the body stream is locked'
    );

    reader.releaseLock();

    const cloned = response.clone();

    assert.strictEqual(await cloned.text(), 'locked');
    assert.strictEqual(await response.text(), 'locked');
  });

  test('should reject cloning once the body stream has been disturbed', async () => {
    const response = new WreqResponse('already used', {
      status: 200,
      url: 'https://local/already-used',
    });

    const reader = response.body?.getReader();

    assert.ok(reader, 'response should expose a reader');

    const firstChunk = await reader.read();

    assert.strictEqual(firstChunk.done, false, 'stream should yield data');
    assert.strictEqual(response.bodyUsed, true, 'reading from the stream should disturb the body');

    assert.throws(
      () => response.clone(),
      (error: unknown) => error instanceof TypeError && error.message.includes('consumed'),
      'clone should reject after the body has been disturbed'
    );
  });

  test('should expose native-backed response streams for fetched responses', async () => {
    const response = await fetch(`${getBaseUrl()}/cookies/echo`);
    const stream = response.body;

    assert.ok(stream, 'fetched response should expose a body stream');
    assert.strictEqual(
      response.bodyUsed,
      false,
      'accessing the fetched body should not mark it used'
    );

    const reader = stream?.getReader();
    const chunks: Uint8Array[] = [];

    while (reader) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      assert.strictEqual(
        response.bodyUsed,
        true,
        'reading the fetched body stream should mark it used'
      );
      chunks.push(result.value);
    }

    const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));

    assert.ok(
      new TextDecoder().decode(merged).includes('"cookie":""'),
      'streamed native response should contain the expected payload'
    );
  });

  test('should support parallel clone consumption for native-backed streamed responses', async () => {
    const response = await fetch(`${getBaseUrl()}/cookies/echo`);
    const cloned = response.clone();
    const [left, right] = await Promise.all([response.text(), cloned.text()]);

    assert.strictEqual(left, right, 'both tee branches should observe the same payload');
    assert.ok(
      left.includes('"cookie":""'),
      'the tee payload should match the fetched response body'
    );
    assert.strictEqual(
      response.bodyUsed,
      true,
      'original response should be marked used after reading'
    );
    assert.strictEqual(
      cloned.bodyUsed,
      true,
      'cloned response should be marked used after reading'
    );
  });

  test('should support formData for urlencoded responses', async () => {
    const response = new WreqResponse('alpha=1&beta=two&beta=three', {
      status: 200,
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      url: 'https://local/form',
    });

    const formData = await response.formData();

    assert.strictEqual(formData.get('alpha'), '1');
    assert.deepStrictEqual(formData.getAll('beta'), ['two', 'three']);
    assert.strictEqual(response.bodyUsed, true, 'formData should consume the body');
  });

  test('should support multipart formData responses with repeated fields and files', async () => {
    const response = new WreqResponse(
      '--XyZ123\r\n' +
        'Content-Disposition: form-data; name="alpha"\r\n' +
        '\r\n' +
        '1\r\n' +
        '--XyZ123\r\n' +
        'Content-Disposition: form-data; name="beta"\r\n' +
        '\r\n' +
        'two\r\n' +
        '--XyZ123\r\n' +
        'Content-Disposition: form-data; name="beta"\r\n' +
        '\r\n' +
        'three\r\n' +
        '--XyZ123\r\n' +
        'Content-Disposition: form-data; name="upload"; filename="hello.txt"\r\n' +
        'Content-Type: text/plain\r\n' +
        '\r\n' +
        'hello world\r\n' +
        '--XyZ123--\r\n',
      {
        status: 200,
        headers: { 'content-type': 'multipart/form-data; boundary="XyZ123"' },
        url: 'https://local/form',
      }
    );

    const formData = await response.formData();
    const upload = formData.get('upload');

    assert.strictEqual(formData.get('alpha'), '1');
    assert.deepStrictEqual(formData.getAll('beta'), ['two', 'three']);
    assert.ok(upload instanceof Blob, 'file part should be represented as a Blob/File');
    assert.strictEqual((upload as File).name, 'hello.txt');
    assert.strictEqual(upload.type, 'text/plain');
    assert.strictEqual(await upload.text(), 'hello world');
    assert.strictEqual(response.bodyUsed, true, 'multipart formData should consume the body');
  });

  test('should reject multipart formData responses without a boundary', async () => {
    const response = new WreqResponse('--test--\r\n', {
      status: 200,
      headers: { 'content-type': 'multipart/form-data' },
      url: 'https://local/form',
    });

    await assert.rejects(
      async () => response.formData(),
      (error: unknown) =>
        error instanceof TypeError &&
        error.message === 'Missing or invalid multipart/form-data boundary in Content-Type header',
      'multipart form parsing should fail when the boundary is missing'
    );

    assert.strictEqual(
      response.bodyUsed,
      true,
      'multipart parse errors should still consume the body'
    );
  });

  test('should reject malformed multipart formData responses with a clear error', async () => {
    const response = new WreqResponse(
      '--test\r\nContent-Disposition: form-data; name="alpha"\r\n\r\n1\r\n',
      {
        status: 200,
        headers: { 'content-type': 'multipart/form-data; boundary=test' },
        url: 'https://local/form',
      }
    );

    await assert.rejects(
      async () => response.formData(),
      (error: unknown) =>
        error instanceof TypeError &&
        error.message === 'Failed to parse multipart/form-data response body',
      'malformed multipart parsing should fail explicitly'
    );

    assert.strictEqual(response.bodyUsed, true, 'multipart parse failures should consume the body');
  });
});
