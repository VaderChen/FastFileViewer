#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
export MACOSX_DEPLOYMENT_TARGET="12.0"
export CGO_CFLAGS="-mmacosx-version-min=12.0"
export CGO_LDFLAGS="-mmacosx-version-min=12.0"
export VITE_APP_VERSION="development"
required_commands=(go node npm)
for command_name in "${required_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少必要指令：$command_name"
    exit 1
  fi
done

# Keep the declared macOS deployment target compatible with the Go toolchain.
export GOTOOLCHAIN="$(awk '$1 == "go" { print "go" $2; exit }' "$SCRIPT_DIR/go.mod")"

cd "$SCRIPT_DIR"
WAILS_VERSION="$(go list -m -f '{{.Version}}' github.com/wailsapp/wails/v2)"
WAILS_BIN="$SCRIPT_DIR/build/tools/$WAILS_VERSION/wails"

if [[ ! -x "$WAILS_BIN" ]]; then
  echo "安裝專案指定的 Wails $WAILS_VERSION ..."
  mkdir -p "$(dirname "$WAILS_BIN")"
  GOBIN="$(dirname "$WAILS_BIN")" GO111MODULE=on go install "github.com/wailsapp/wails/v2/cmd/wails@$WAILS_VERSION"
fi

echo "依 package-lock.json 安裝前端依賴..."
(cd "$FRONTEND_DIR" && npm ci)

echo "從專案目錄啟動 FastFileViewer 開發模式..."
exec "$WAILS_BIN" dev -m -nosyncgomod
