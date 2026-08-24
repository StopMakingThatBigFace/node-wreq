import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const binaryArgument = process.argv[2];

if (!binaryArgument) {
  throw new Error('Expected a native binary path');
}

const binaryPath = resolve(binaryArgument);

if (!existsSync(binaryPath)) {
  throw new Error(`Native binary does not exist: ${binaryPath}`);
}

const abiLimits = new Map([
  ['GLIBC_', '2.28'],
  ['GLIBCXX_', '3.4.25'],
  ['CXXABI_', '1.3.11'],
]);

const allowedLibraries = new Set([
  'ld-linux-aarch64.so.1',
  'ld-linux-x86-64.so.2',
  'libatomic.so.1',
  'libc.so.6',
  'libdl.so.2',
  'libgcc_s.so.1',
  'libm.so.6',
  'libpthread.so.0',
  'libresolv.so.2',
  'librt.so.1',
  'libstdc++.so.6',
  'libutil.so.1',
]);

function readelf(...args) {
  const result = spawnSync('readelf', [...args, binaryPath], {
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `readelf ${args.join(' ')} failed with exit code ${result.status}:\n${result.stderr}`
    );
  }

  return result.stdout;
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function collectVersions(output, prefix) {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escapedPrefix}(\\d+(?:\\.\\d+)*)\\b`, 'g');

  return [...new Set([...output.matchAll(pattern)].map((match) => match[1]))].toSorted(
    compareVersions
  );
}

const versionInfo = readelf('--version-info', '--wide');
const summaries = [];

for (const [prefix, limit] of abiLimits) {
  const versions = collectVersions(versionInfo, prefix);
  const unsupported = versions.filter((version) => compareVersions(version, limit) > 0);

  if (unsupported.length > 0) {
    throw new Error(
      `${binaryPath} requires unsupported ${prefix}${unsupported.join(`, ${prefix}`)}; maximum supported version is ${prefix}${limit}`
    );
  }

  if (versions.length > 0) {
    summaries.push(`${prefix}${versions.at(-1)}`);
  }
}

const dynamicInfo = readelf('--dynamic', '--wide');
const requiredLibraries = [...dynamicInfo.matchAll(/Shared library: \[([^\]]+)]/g)].map(
  (match) => match[1]
);

const unexpectedLibraries = requiredLibraries.filter((library) => !allowedLibraries.has(library));

if (unexpectedLibraries.length > 0) {
  throw new Error(
    `${binaryPath} requires unexpected shared libraries: ${unexpectedLibraries.join(', ')}`
  );
}

console.log(
  `Verified ${binaryPath}: ${summaries.join(', ') || 'no versioned GNU ABI imports'}; shared libraries: ${requiredLibraries.join(', ') || 'none'}`
);
