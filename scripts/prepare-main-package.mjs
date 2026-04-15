import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOptionalDependencyMap } from './platform-targets.mjs';
import { resolvePublishVersion } from './publish-version.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = resolve(repoRoot, process.argv[2] ?? '.release/main-package');

const rootPackage = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
const publishVersion = resolvePublishVersion(rootPackage);

await rm(outDir, { recursive: true, force: true });

await mkdir(outDir, { recursive: true });

await cp(resolve(repoRoot, 'dist'), resolve(outDir, 'dist'), {
  recursive: true,
});

await rm(resolve(outDir, 'dist/test'), { recursive: true, force: true });

await cp(resolve(repoRoot, 'docs'), resolve(outDir, 'docs'), {
  recursive: true,
});

await cp(resolve(repoRoot, 'README.md'), resolve(outDir, 'README.md'));

const publishPackage = {
  name: rootPackage.name,
  version: publishVersion,
  description: rootPackage.description,
  main: rootPackage.main,
  module: rootPackage.module,
  types: rootPackage.types,
  exports: rootPackage.exports,
  keywords: rootPackage.keywords,
  author: rootPackage.author,
  license: rootPackage.license,
  repository: rootPackage.repository,
  bugs: rootPackage.bugs,
  homepage: rootPackage.homepage,
  engines: rootPackage.engines,
  os: rootPackage.os,
  cpu: rootPackage.cpu,
  optionalDependencies: getOptionalDependencyMap(publishVersion),
  files: ['dist', 'docs', 'README.md'],
};

await writeFile(
  resolve(outDir, 'package.json'),
  `${JSON.stringify(publishPackage, null, 2)}\n`,
  'utf8'
);
