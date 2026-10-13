#!/bin/sh
# Build phases for the Safari project (project.yml). The extension's files live once, in voucherboard/; nothing here
# is a copy of them.
#   extension.sh copy <dir>     manifest.json without Chrome's "key", and the folders it refers to, into <dir>
#   extension.sh version <file>  writes "#define VB_VERSION <manifest.json's version>", for the Info.plists
# test/safari.test.js runs "copy" too (macOS only: it needs plutil).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIRS="src guide icons" # package.mjs FILES, apart from manifest.json
VERSION=$(/usr/bin/plutil -extract version raw -o - "$ROOT/manifest.json")

case "${1:-}" in
copy)
  DEST=${2:?usage: extension.sh copy <dir>}
  mkdir -p "$DEST"
  for d in $DIRS; do
    [ -d "$ROOT/$d" ] || { echo "error: missing voucherboard/$d"; exit 1; }
    rm -rf "${DEST:?}/$d"
    cp -R "$ROOT/$d" "$DEST/$d"
  done
  find "$DEST" \( -name .DS_Store -o -name README.md \) -type f -delete
  # Safari gives the extension its own id; Chrome's public key means nothing to it.
  cp "$ROOT/manifest.json" "$DEST/manifest.json"
  /usr/bin/plutil -remove key "$DEST/manifest.json" 2>/dev/null || true
  /usr/bin/plutil -convert json -r "$DEST/manifest.json"
  ;;
version)
  OUT=${2:?usage: extension.sh version <file>}
  mkdir -p "$(dirname "$OUT")"
  printf '#define VB_VERSION %s\n' "$VERSION" > "$OUT"
  ;;
*)
  echo "usage: extension.sh copy <dir> | version <file>" >&2
  exit 2
  ;;
esac
