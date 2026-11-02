#!/bin/sh
# Build phases for the Safari project (project.yml). The extension's files live once, in extension/; nothing here
# is a copy of them.
#   extension.sh copy <dir>  manifest.json without Chrome's "key", with Safari's version, and the folders it refers
#                            to, into <dir>
# Safari's version is MARKETING_VERSION: Xcode's, in a build, or project.yml's (release-please keeps it).
# test/safari.test.js runs "copy" too (macOS only: it needs plutil).
set -eu
ROOT=$(cd "$(dirname "$0")/../../extension" && pwd)
DIRS="src guide icons" # package.mjs FILES, apart from manifest.json
VERSION=${MARKETING_VERSION:-$(sed -nE 's/^ *MARKETING_VERSION: *"?([0-9.]+)"?.*/\1/p' "$(dirname "$0")/project.yml")}
[ -n "$VERSION" ] || { echo "error: no MARKETING_VERSION in project.yml"; exit 1; }

case "${1:-}" in
copy)
  DEST=${2:?usage: extension.sh copy <dir>}
  mkdir -p "$DEST"
  for d in $DIRS; do
    [ -d "$ROOT/$d" ] || { echo "error: missing extension/$d"; exit 1; }
    rm -rf "${DEST:?}/$d"
    cp -R "$ROOT/$d" "$DEST/$d"
  done
  find "$DEST" \( -name .DS_Store -o -name README.md \) -type f -delete
  # Safari gives the extension its own id; Chrome's public key means nothing to it.
  cp "$ROOT/manifest.json" "$DEST/manifest.json"
  /usr/bin/plutil -remove key "$DEST/manifest.json" 2>/dev/null || true
  # Safari's own version, so the update check (src/updates.js) compares it with safari-v* releases.
  /usr/bin/plutil -replace version -string "$VERSION" "$DEST/manifest.json"
  /usr/bin/plutil -convert json -r "$DEST/manifest.json"
  ;;
*)
  echo "usage: extension.sh copy <dir>" >&2
  exit 2
  ;;
esac
