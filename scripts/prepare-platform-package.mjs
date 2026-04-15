import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformTargetByTriple } from './platform-targets.mjs';
import { resolvePublishVersion } from './publish-version.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key.startsWith('--')) {
      continue;
    }

    args[key.slice(2)] = value;
    index += 1;
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const target = getPlatformTargetByTriple(args.target);

if (!target) {
  throw new Error(`Unknown publish target: ${args.target}`);
}

if (!args.binary) {
  throw new Error('Missing required --binary argument');
}

if (!args.outDir) {
  throw new Error('Missing required --outDir argument');
}

const rootPackage = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
const publishVersion = resolvePublishVersion(rootPackage);
const outDir = resolve(repoRoot, args.outDir);
const binarySource = resolve(repoRoot, args.binary);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(binarySource, resolve(outDir, target.binaryName));

const packageJson = {
  name: target.packageName,
  version: publishVersion,
  description: `Prebuilt native binding for ${rootPackage.name} on ${target.target}`,
  license: rootPackage.license,
  author: rootPackage.author,
  repository: rootPackage.repository,
  bugs: rootPackage.bugs,
  homepage: rootPackage.homepage,
  os: target.os,
  cpu: target.cpu,
  ...(target.libc ? { libc: target.libc } : {}),
  main: `./${target.binaryName}`,
  files: [target.binaryName, 'README.md'],
  publishConfig: {
    access: 'public',
  },
};

const mainPackageUrl =
  typeof rootPackage.homepage === 'string'
    ? rootPackage.homepage.replace(/#readme$/, '')
    : `https://www.npmjs.com/package/${rootPackage.name}`;

const readme = `# ${target.packageName}

This package only contains the prebuilt native platform binary.

It is a helper package used by [\`${rootPackage.name}\`](${mainPackageUrl}).

You should install the main package instead:

\`\`\`bash
npm install ${rootPackage.name}
\`\`\`

Target triple: \`${target.target}\`
Binary: \`${basename(target.binaryName)}\`
`;

await writeFile(
  resolve(outDir, 'package.json'),
  `${JSON.stringify(packageJson, null, 2)}\n`,
  'utf8'
);

await writeFile(resolve(outDir, 'README.md'), readme, 'utf8');
