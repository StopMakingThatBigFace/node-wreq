# Build Instructions

This guide is for developers who want to build `node-wreq` from source. If you just want to use the library, see the main [README.md](../README.md) — pre-built binaries are included with the npm package.

## Prerequisites

### 1. [Install Rust](https://rust-lang.org/tools/install)

The exact toolchain version is pinned in `rust-toolchain.toml`; `rustup` installs it automatically.

### 2. Install CMake and Clang

BoringSSL is compiled from source, which needs CMake and a C/C++ compiler. Its Rust bindings are
generated with `bindgen`, which needs `libclang`:

```bash
# macOS (Clang ships with the Xcode Command Line Tools)
brew install cmake

# Ubuntu/Debian
sudo apt-get install build-essential cmake clang libclang-dev git

# Verify installation
cmake --version
```

## Building the Project

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Build Rust Module

```bash
npm run build:rust
```

This will:
1. Compile Rust code with release optimizations
2. Create the native Node.js addon for your platform, for example
   `rust/node-wreq.darwin-arm64.node` or `rust/node-wreq.linux-x64-gnu.node`

**Troubleshooting:**

If you get errors about missing dependencies:

```bash
# macOS - install build tools
xcode-select --install

# Ubuntu/Debian
sudo apt-get install build-essential cmake clang libclang-dev git
```

### Step 3: Build TypeScript

```bash
npm run build:ts
```

This regenerates the browser profile list from the native module built in step 2, then compiles
TypeScript files to the `dist/` folder.

## Development Workflow

### Full Build

```bash
npm run build
```

This runs both Rust and TypeScript builds.

### Watch Mode (TypeScript only)

```bash
npx tsc --watch
```

### Clean Build

```bash
npm run clean
npm run build
```

## Platform-Specific Notes

### macOS

- Xcode Command Line Tools required

### Linux

OpenSSL development libraries are not needed: BoringSSL is built from source.

```bash
# Ubuntu/Debian
sudo apt-get install build-essential cmake clang libclang-dev git

# Fedora/RHEL
sudo dnf install gcc gcc-c++ cmake clang git
```

If `bindgen` cannot find `libclang`, point it at the library directory, for example
`LIBCLANG_PATH=/usr/lib64` (this is what the CI build does).

### Windows

- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
- Building inside WSL2 also works, but it produces a Linux binary that only runs inside WSL

```bash
# In WSL2 Ubuntu
sudo apt-get install build-essential cmake clang libclang-dev git
```

## Performance Optimization

The Rust module is already optimized with:

```toml
[profile.release]
opt-level = 3        # Maximum optimization
lto = true           # Link-time optimization
codegen-units = 1    # Single codegen unit
```

For even better performance, you can use:

```bash
RUSTFLAGS="-C target-cpu=native" npm run build:rust
```

This will optimize for your specific CPU architecture.

## Troubleshooting

### Error: "Failed to load native module"

The native addon for your platform has not been built yet:

```bash
npm run build:rust
```

### Error: "napi build failed"

```bash
# Update napi-rs
npm install

# Clean and rebuild
npx rimraf rust/target
npm run build:rust
```

## Cross-Platform Building

### Build for Different Targets

```bash
# List available targets
rustup target list

# Add target
rustup target add x86_64-unknown-linux-gnu
rustup target add aarch64-unknown-linux-gnu
rustup target add x86_64-pc-windows-msvc

# Build for specific target
npm run build:rust -- --target x86_64-unknown-linux-gnu
```

Cross-compiling also needs a C/C++ toolchain for the target, because BoringSSL is built from
source. See `.github/workflows/build.yml` for the setup used for each published platform,
including the musl targets.

## Debugging

### Enable Verbose Build

```bash
npm run build:rust -- --cargo-flags="--verbose"
```

### Check Binary Info

```bash
# macOS/Linux
file rust/*.node
otool -L rust/*.node  # macOS
ldd rust/*.node       # Linux

# Check size
ls -lh rust/*.node
```
