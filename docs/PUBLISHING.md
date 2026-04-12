# Publishing Guide

## How to Publish node-wreq

Publishing is split into two layers:

- scoped platform packages with the native `.node` binaries
- the main `node-wreq` package with JS, types, loader logic, and `optionalDependencies`

The publish version can be overridden at staging time with `NODE_WREQ_PUBLISH_VERSION`.
That lets CI publish from the GitHub release tag even if the repository's root `package.json`
stays on a placeholder or development version locally.

### Package Structure

When published, the package includes:
- main package:
  - CommonJS output in `dist/`
  - ESM wrapper output in `dist/`
  - Type declarations in `dist/`
  - `optionalDependencies` pointing at the scoped native packages
- scoped platform packages:
  - one native `.node` binary each

Scoped package names:

- `@node-wreq/darwin-x64`
- `@node-wreq/darwin-arm64`
- `@node-wreq/linux-x64-gnu`
- `@node-wreq/linux-arm64-gnu`
- `@node-wreq/linux-x64-musl`
- `@node-wreq/win32-x64-msvc`

### Publishing Process

#### 1. Prerequisites

- npm account with package publish permissions
- GitHub repository set up
- npm trusted publishing configured for each package you publish from this workflow

#### 1. Update Version

```bash
# Bump version using npm
npm version patch  # 0.1.0 → 0.1.1
npm version minor  # 0.1.0 → 0.2.0
npm version major  # 0.1.0 → 1.0.0
```

#### 2. Create GitHub Release

```bash
# Push version tag
git push --follow-tags

# Or manually create tag
git tag v0.1.0
git push origin v0.1.0
```

Then create a GitHub Release from this tag. This will trigger the build workflow.

#### 3. Automated Build & Publish

GitHub Actions will automatically:
1. Build native binaries for all configured platforms
2. Publish one scoped package per platform artifact
3. Build the JS outputs
4. Stage the main package with generated `optionalDependencies`
5. Publish the main package to npm

Workflow requirements for trusted publishing:

- the trusted publisher must point at this repository and the exact workflow filename: `.github/workflows/build.yml`
- publish jobs must run on GitHub-hosted runners
- publish jobs need `permissions.id-token: write`
- no `NPM_TOKEN` is required for the `npm publish` steps

Release tag behavior:

- prereleases publish with npm dist-tag `rc`
- stable releases publish with npm dist-tag `latest`
- the published package version is derived from the GitHub release tag, for example `v1.0.0-rc2` -> `1.0.0-rc2`

### Local Testing Before Publishing

```bash
# Build everything
npm run build

# Run tests
npm test

# Stage the publishable main package
npm run prepare:publish:main -- .release/main-package

# Inspect staged files
find .release/main-package -maxdepth 3 -type f | sort
```

### Manual Publishing (Platform Packages)

If you really need to publish a scoped platform package manually:

```bash
# Example: build a target
npm run build:rust -- --target x86_64-unknown-linux-musl

# Stage the scoped package
NODE_WREQ_PUBLISH_VERSION=1.0.0-rc2 node ./scripts/prepare-platform-package.mjs \
  --target x86_64-unknown-linux-musl \
  --binary rust/node-wreq.linux-x64-musl.node \
  --outDir .release/linux-x64-musl

# Publish it
npm publish .release/linux-x64-musl --access public
```

### Manual Publishing (Main Package)

After the platform packages for the same version exist:

```bash
npm run build:ts
NODE_WREQ_PUBLISH_VERSION=1.0.0-rc2 npm run prepare:publish:main -- .release/main-package
npm publish .release/main-package --access public
```

Use GitHub Actions unless you have a specific reason not to.

## Troubleshooting

### Build Fails in CI

- Check that all platform targets are properly configured
- Verify Rust toolchain is installed correctly
- Check CMake is available (required for BoringSSL)

### Module Load Error After Install

- Verify the matching scoped package for the user's platform was published
- Verify the main package version and platform package versions match
- Check that the loader can resolve the correct package for the user's platform
