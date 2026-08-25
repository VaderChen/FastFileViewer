#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_BUILD_CACHE="${FASTFILEVIEWER_BUILD_CACHE:-${TMPDIR:-/tmp}/fastfileviewer-build-cache}"

rm -rf \
  "$SCRIPT_DIR/build/bin" \
  "$SCRIPT_DIR/dist" \
  "$SCRIPT_DIR/build/tools" \
  "$SCRIPT_DIR/dist" \
  "$SCRIPT_DIR/frontend/dist" \
  "$SCRIPT_DIR/THIRD-PARTY-LICENSES.txt"

if [[ -L "$SCRIPT_DIR/frontend/node_modules" ]]; then
  rm -f "$SCRIPT_DIR/frontend/node_modules"
fi

rm -rf "$LOCAL_BUILD_CACHE"

find "$SCRIPT_DIR" \
  -path "$SCRIPT_DIR/frontend/node_modules" -prune -o \
  \( -name '._*' -o -name '.DS_Store' \) -print -delete

echo "已清除建置產物與 AppleDouble 檔案。"
