import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

test('should expose Request as a named ESM export', () => {
  const entry = pathToFileURL(resolve(__dirname, '../node-wreq.mjs')).href;
  const script = `
    import { Request } from ${JSON.stringify(entry)};
    const request = new Request('https://example.com/');
    if (request.url !== 'https://example.com/') process.exit(1);
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
  });

  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
});
