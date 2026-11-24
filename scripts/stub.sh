#!/usr/bin/env bash
# Reserves the scoped platform package names on npm with placeholder packages,
# so trusted publishing can be configured for them before the first release.
#
# Packages that already exist on npm are skipped, so this can be re-run every
# time a platform is added. Extra arguments go to `npm publish`:
#
#   ./scripts/stub.sh --dry-run
set -euo pipefail

VERSION=0.0.0-reserved.0
OUT=.release-stubs

rm -rf "$OUT"
mkdir -p "$OUT"

create_stub () {
  DIR="$1"
  NAME="$2"
  OS_JSON="$3"
  CPU_JSON="$4"
  LIBC_JSON="$5"

  mkdir -p "$OUT/$DIR"

  cat > "$OUT/$DIR/package.json" <<EOF
{
  "name": "$NAME",
  "version": "$VERSION",
  "description": "Temporary placeholder package for trusted publishing setup",
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  },
  "os": $OS_JSON,
  "cpu": $CPU_JSON$( [ -n "$LIBC_JSON" ] && printf ',\n  "libc": %s' "$LIBC_JSON" )
}
EOF

  cat > "$OUT/$DIR/README.md" <<EOF
# $NAME

Temporary placeholder package used only to reserve the package name and configure GitHub trusted publishing.

Do not install this package directly.
EOF
}

reserve () {
  DIR="$1"
  NAME="$2"

  if VIEW_OUTPUT="$(npm view "$NAME" name 2>&1)"; then
    echo "skip    $NAME (already on npm)"
    return
  fi

  # Only a 404 means the name is free; anything else (network, auth) is fatal.
  if ! printf '%s\n' "$VIEW_OUTPUT" | grep -q 'E404'; then
    echo "Could not check whether $NAME exists on npm:" >&2
    printf '%s\n' "$VIEW_OUTPUT" >&2
    exit 1
  fi

  echo "reserve $NAME"
  create_stub "$@"
  npm publish "$OUT/$DIR" --access public --tag reserved ${PUBLISH_ARGS[@]+"${PUBLISH_ARGS[@]}"}
}

PUBLISH_ARGS=("$@")

reserve "darwin-x64" "@node-wreq/darwin-x64" '["darwin"]' '["x64"]' ''
reserve "darwin-arm64" "@node-wreq/darwin-arm64" '["darwin"]' '["arm64"]' ''
reserve "linux-x64-gnu" "@node-wreq/linux-x64-gnu" '["linux"]' '["x64"]' '["glibc"]'
reserve "linux-arm64-gnu" "@node-wreq/linux-arm64-gnu" '["linux"]' '["arm64"]' '["glibc"]'
reserve "linux-x64-musl" "@node-wreq/linux-x64-musl" '["linux"]' '["x64"]' '["musl"]'
reserve "linux-arm64-musl" "@node-wreq/linux-arm64-musl" '["linux"]' '["arm64"]' '["musl"]'
reserve "win32-x64-msvc" "@node-wreq/win32-x64-msvc" '["win32"]' '["x64"]' ''
