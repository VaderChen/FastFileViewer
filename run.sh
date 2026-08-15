#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
LOCAL_BUILD_CACHE="${FASTFILEVIEWER_BUILD_CACHE:-${TMPDIR:-/tmp}/fastfileviewer-build-cache}"
TMP_ROOT=""
SYNC_WATCHER_PID=""
export MACOSX_DEPLOYMENT_TARGET="12.0"
export CGO_CFLAGS="-mmacosx-version-min=12.0"
export CGO_LDFLAGS="-mmacosx-version-min=12.0"
export VITE_APP_VERSION="development"
export COPYFILE_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE=1

cleanup_dev_runtime() {
  if [[ -n "$SYNC_WATCHER_PID" ]]; then
    pkill -P "$SYNC_WATCHER_PID" >/dev/null 2>&1 || true
    kill "$SYNC_WATCHER_PID" >/dev/null 2>&1 || true
    wait "$SYNC_WATCHER_PID" 2>/dev/null || true
  fi
  if [[ -n "$TMP_ROOT" && -d "$TMP_ROOT" ]]; then
    rm -rf "$TMP_ROOT" 2>/dev/null || true
  fi
}
trap cleanup_dev_runtime EXIT INT TERM

required_commands=(go node npm rsync)
for command_name in "${required_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少必要指令：$command_name"
    exit 1
  fi
done

cd "$SCRIPT_DIR"
WAILS_VERSION="$(go list -m -f '{{.Version}}' github.com/wailsapp/wails/v2)"
WAILS_BIN="$LOCAL_BUILD_CACHE/tools/$WAILS_VERSION/wails"
FRONTEND_INSTALL_DIR="$LOCAL_BUILD_CACHE/frontend"

if [[ ! -x "$WAILS_BIN" ]]; then
  echo "安裝專案指定的 Wails $WAILS_VERSION ..."
  mkdir -p "$(dirname "$WAILS_BIN")"
  GOBIN="$(dirname "$WAILS_BIN")" GO111MODULE=on go install "github.com/wailsapp/wails/v2/cmd/wails@$WAILS_VERSION"
fi

if [[ ! -d "$FRONTEND_INSTALL_DIR/node_modules" || "$FRONTEND_DIR/package-lock.json" -nt "$FRONTEND_INSTALL_DIR/package-lock.json" ]]; then
  rm -rf "$FRONTEND_INSTALL_DIR"
  mkdir -p "$FRONTEND_INSTALL_DIR"
  cp "$FRONTEND_DIR/package.json" "$FRONTEND_DIR/package-lock.json" "$FRONTEND_INSTALL_DIR/"
  (cd "$FRONTEND_INSTALL_DIR" && npm ci)
fi

if [[ -L "$FRONTEND_DIR/node_modules" ]]; then
  rm -f "$FRONTEND_DIR/node_modules"
elif [[ -e "$FRONTEND_DIR/node_modules" ]]; then
  rm -rf "$FRONTEND_DIR/node_modules"
fi
ln -s "$FRONTEND_INSTALL_DIR/node_modules" "$FRONTEND_DIR/node_modules"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fastfileviewer-dev.XXXXXX")"
STAGING_DIR="$TMP_ROOT/project"

sync_project_to_local() {
  rsync -rlc --delete \
    --exclude '.git/' \
    --exclude '.DS_Store' \
    --exclude '._*' \
    --exclude '*.bak' \
    --exclude 'cert/' \
    --exclude 'build/bin/' \
    --exclude 'dist/' \
    --exclude 'frontend/dist/' \
    --exclude 'frontend/node_modules/' \
    --exclude 'frontend/wailsjs/' \
    "$SCRIPT_DIR/" "$STAGING_DIR/"
}

echo "建立本機開發鏡像：$STAGING_DIR"
mkdir -p "$STAGING_DIR/frontend"
sync_project_to_local
ln -s "$FRONTEND_INSTALL_DIR/node_modules" "$STAGING_DIR/frontend/node_modules"
ln -s "$FRONTEND_DIR/wailsjs" "$STAGING_DIR/frontend/wailsjs"

echo "監看原專案並同步至開發鏡像..."
(
  while true; do
    sync_project_to_local
    sleep 0.4
  done
) &
SYNC_WATCHER_PID=$!

echo "啟動 FastFileViewer 開發模式..."
cd "$STAGING_DIR"
"$WAILS_BIN" dev -m -nosyncgomod
