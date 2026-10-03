#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

rm -rf \
  "$SCRIPT_DIR/build/bin" \
  "$SCRIPT_DIR/dist" \
  "$SCRIPT_DIR/build/tools" \
  "$SCRIPT_DIR/frontend/dist" \
  "$SCRIPT_DIR/THIRD-PARTY-LICENSES.txt"
echo "已清除專案內的建置產物與 Wails CLI。"
