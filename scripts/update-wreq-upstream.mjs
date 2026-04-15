#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(new URL('../rust/Cargo.toml', import.meta.url));

const upstreamCrates = [
  { dependency: 'wreq', crate: 'wreq' },
  { dependency: 'wreq-util', crate: 'wreq-util' },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchLatestVersion(crate) {
  const response = await fetch(`https://crates.io/api/v1/crates/${crate}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'node-wreq-upstream-monitor',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${crate} metadata from crates.io: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const latestVersion = payload?.crate?.max_version;

  if (typeof latestVersion !== 'string' || latestVersion.length === 0) {
    throw new Error(`crates.io did not return max_version for ${crate}`);
  }

  return latestVersion;
}

function replaceDependencyVersion(content, dependency, latestVersion) {
  const pattern = new RegExp(
    `(^\\s*${escapeRegExp(dependency)}\\s*=\\s*\\{[^\\n]*\\bversion\\s*=\\s*")([^"]+)(")`,
    'm'
  );

  const match = content.match(pattern);

  if (!match) {
    throw new Error(`Could not find a version field for ${dependency} in rust/Cargo.toml`);
  }

  const currentVersion = match[2];

  if (currentVersion === latestVersion) {
    return { changed: false, content, currentVersion };
  }

  return {
    changed: true,
    currentVersion,
    content: content.replace(pattern, `$1${latestVersion}$3`),
  };
}

function updateLockfile(dependency, version) {
  execFileSync(
    'cargo',
    ['update', '--manifest-path', 'rust/Cargo.toml', '-p', dependency, '--precise', version],
    { stdio: 'inherit' }
  );
}

async function main() {
  let manifest = await readFile(manifestPath, 'utf8');
  const plannedUpdates = [];

  for (const entry of upstreamCrates) {
    const latestVersion = await fetchLatestVersion(entry.crate);
    const result = replaceDependencyVersion(manifest, entry.dependency, latestVersion);

    if (!result.changed) {
      console.log(`${entry.dependency} is already at ${latestVersion}`);
      continue;
    }

    manifest = result.content;
    plannedUpdates.push({
      dependency: entry.dependency,
      currentVersion: result.currentVersion,
      latestVersion,
    });
  }

  if (plannedUpdates.length === 0) {
    console.log('No upstream wreq crate updates found.');

    return;
  }

  await writeFile(manifestPath, manifest);

  for (const update of plannedUpdates) {
    console.log(`Updating ${update.dependency}: ${update.currentVersion} -> ${update.latestVersion}`);
    updateLockfile(update.dependency, update.latestVersion);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
