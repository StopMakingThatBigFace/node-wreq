import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const gitDir = resolve(repoRoot, '.git');
const hooksPath = resolve(repoRoot, '.githooks');

if (!existsSync(gitDir) || !existsSync(hooksPath)) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
} catch (error) {
  console.warn('[install-git-hooks] Failed to set core.hooksPath to .githooks');
  console.warn(error instanceof Error ? error.message : String(error));
}
