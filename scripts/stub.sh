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

create_stub "darwin-x64" "@node-wreq/darwin-x64" '["darwin"]' '["x64"]' ''
create_stub "darwin-arm64" "@node-wreq/darwin-arm64" '["darwin"]' '["arm64"]' ''
create_stub "linux-x64-gnu" "@node-wreq/linux-x64-gnu" '["linux"]' '["x64"]' '["glibc"]'
create_stub "linux-arm64-gnu" "@node-wreq/linux-arm64-gnu" '["linux"]' '["arm64"]' '["glibc"]'
create_stub "linux-x64-musl" "@node-wreq/linux-x64-musl" '["linux"]' '["x64"]' '["musl"]'
create_stub "win32-x64-msvc" "@node-wreq/win32-x64-msvc" '["win32"]' '["x64"]' ''

npm publish "$OUT/darwin-x64" --access public --tag reserved
npm publish "$OUT/darwin-arm64" --access public --tag reserved
npm publish "$OUT/linux-x64-gnu" --access public --tag reserved
npm publish "$OUT/linux-arm64-gnu" --access public --tag reserved
npm publish "$OUT/linux-x64-musl" --access public --tag reserved
npm publish "$OUT/win32-x64-msvc" --access public --tag reserved
