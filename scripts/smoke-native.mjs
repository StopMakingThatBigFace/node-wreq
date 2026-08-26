import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const binaryPath = process.argv[2];

if (!binaryPath) {
  throw new Error('Expected a native binary path');
}

const require = createRequire(import.meta.url);
const binding = require(resolve(binaryPath));
const profiles = binding.getProfiles();

if (!Array.isArray(profiles) || profiles.length === 0) {
  throw new Error('Native binding returned no browser profiles');
}

console.log(`Loaded ${binaryPath} with ${profiles.length} browser profiles`);
