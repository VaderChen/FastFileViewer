#!/bin/zsh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
export APP_OUTPUT_DIR="$SCRIPT_DIR/dist"
exec "$SCRIPT_DIR/build.sh" "$@"
