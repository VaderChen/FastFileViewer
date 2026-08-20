#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
APP_NAME="FastFileViewer"
APP_PATH="$SCRIPT_DIR/build/bin/$APP_NAME.app"
TMP_ROOT=""
LOCAL_BUILD_CACHE="${FASTFILEVIEWER_BUILD_CACHE:-${TMPDIR:-/tmp}/fastfileviewer-build-cache}"

export MACOSX_DEPLOYMENT_TARGET="12.0"
export CGO_CFLAGS="-mmacosx-version-min=12.0"
export CGO_LDFLAGS="-mmacosx-version-min=12.0"
export COPYFILE_DISABLE=1
export COPY_EXTENDED_ATTRIBUTES_DISABLE=1

CODESIGN_IDENTITY="${CODESIGN_IDENTITY:--}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.vader.fastfileviewer}"
BUILD_SOURCE_URL="${BUILD_SOURCE_URL:-https://github.com/VaderChen/FastFileViewer}"
APP_MARKETING_VERSION="${APP_MARKETING_VERSION:-1.$(date +%y).$(date +%m%d)}"
APP_BUILD_LABEL="${APP_BUILD_LABEL:-$(date +%H%M)}"
APP_DISPLAY_VERSION="$APP_MARKETING_VERSION build $APP_BUILD_LABEL"
APP_BUNDLE_VERSION="${APP_BUNDLE_VERSION:-$APP_MARKETING_VERSION.$APP_BUILD_LABEL}"

if (( $# > 0 )); then
  echo "用法：$0"
  echo "未指定本機簽章設定時使用 ad-hoc 簽章，且不啟用 App Sandbox。"
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "此腳本只支援 Apple Silicon macOS。"
  exit 1
fi

if [[ ! "$APP_MARKETING_VERSION" =~ '^[0-9]+([.][0-9]+)*$' ]]; then
  echo "APP_MARKETING_VERSION 格式錯誤：$APP_MARKETING_VERSION"
  exit 1
fi
if [[ ! "$APP_BUNDLE_VERSION" =~ '^[0-9]+([.][0-9]+)*$' ]]; then
  echo "APP_BUNDLE_VERSION 格式錯誤：$APP_BUNDLE_VERSION"
  exit 1
fi
if [[ ! "$APP_BUNDLE_ID" =~ '^[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+$' ]]; then
  echo "APP_BUNDLE_ID 格式錯誤：$APP_BUNDLE_ID"
  exit 1
fi

export VITE_APP_VERSION="$APP_DISPLAY_VERSION"

cleanup_tmp_root() {
  if [[ -n "$TMP_ROOT" && -d "$TMP_ROOT" ]]; then
    rm -rf "$TMP_ROOT"
  fi
}
trap cleanup_tmp_root EXIT

cleanup_appledouble() {
  local target_path="$1"
  if [[ -e "$target_path" ]]; then
    find "$target_path" -name '._*' -delete 2>/dev/null || true
    find "$target_path" -name '.DS_Store' -delete 2>/dev/null || true
  fi
}

cleanup_codesign_artifacts() {
  local target_path="$1"
  if [[ -e "$target_path" ]]; then
    find "$target_path" -name '_CodeSignature' -type d -prune -exec rm -rf {} + 2>/dev/null || true
    find "$target_path" -name 'CodeResources' -type f -delete 2>/dev/null || true
  fi
}

required_commands=(go node npm rsync codesign ditto security)
for command_name in "${required_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少必要指令：$command_name"
    exit 1
  fi
done

if [[ "$CODESIGN_IDENTITY" != "-" ]] &&
  ! security find-identity -v -p codesigning | grep -Fq "$CODESIGN_IDENTITY"; then
  echo "找不到指定的本機簽章身份。"
  exit 1
fi

cd "$SCRIPT_DIR"
WAILS_VERSION="$(go list -m -f '{{.Version}}' github.com/wailsapp/wails/v2)"
WAILS_BIN="$LOCAL_BUILD_CACHE/tools/$WAILS_VERSION/wails"
FRONTEND_INSTALL_DIR="$LOCAL_BUILD_CACHE/frontend"

if [[ ! -x "$WAILS_BIN" ]]; then
  echo "安裝專案指定的 Wails $WAILS_VERSION ..."
  mkdir -p "$(dirname "$WAILS_BIN")"
  GOBIN="$(dirname "$WAILS_BIN")" GO111MODULE=on go install "github.com/wailsapp/wails/v2/cmd/wails@$WAILS_VERSION"
fi

echo "依 package-lock.json 安裝前端依賴..."
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

echo "驗證 Go 與前端原始碼..."
go mod verify
go vet ./...
go test -race ./...
(cd "$FRONTEND_DIR" && npm test && npm audit --omit=dev)

echo "產生第三方授權清冊..."
node "$SCRIPT_DIR/scripts/generate-third-party-notices.mjs"

echo "建置前端資產：$APP_DISPLAY_VERSION"
(cd "$FRONTEND_DIR" && npm run build)
cleanup_appledouble "$FRONTEND_DIR/dist"

if command -v git >/dev/null 2>&1 && git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BUILD_COMMIT="${BUILD_COMMIT:-$(git -C "$SCRIPT_DIR" rev-parse HEAD)}"
  EXACT_TAG="$(git -C "$SCRIPT_DIR" describe --tags --exact-match HEAD 2>/dev/null || true)"
  BUILD_TAG="${BUILD_TAG:-${EXACT_TAG:-untagged}}"
  if [[ -z "${BUILD_STATE:-}" ]]; then
    if [[ -n "$(git -C "$SCRIPT_DIR" status --porcelain=v1 --untracked-files=normal)" ]]; then
      BUILD_STATE="dirty"
    else
      BUILD_STATE="clean"
    fi
  fi
else
  BUILD_COMMIT="${BUILD_COMMIT:-unknown}"
  BUILD_TAG="${BUILD_TAG:-untagged}"
  BUILD_STATE="${BUILD_STATE:-unknown}"
fi

for metadata_value in "$BUILD_COMMIT" "$BUILD_TAG" "$BUILD_STATE" "$BUILD_SOURCE_URL"; do
  if [[ ! "$metadata_value" =~ '^[A-Za-z0-9._/:+-]+$' ]]; then
    echo "建置中繼資料包含不支援的字元：$metadata_value"
    exit 1
  fi
done

BUILD_LDFLAGS="-X github.com/VaderChen/FastFileViewer/internal/app.appVersion=$APP_MARKETING_VERSION -X github.com/VaderChen/FastFileViewer/internal/app.appCommit=$BUILD_COMMIT -X github.com/VaderChen/FastFileViewer/internal/app.appTag=$BUILD_TAG -X github.com/VaderChen/FastFileViewer/internal/app.appBuildState=$BUILD_STATE -X github.com/VaderChen/FastFileViewer/internal/app.appSourceURL=$BUILD_SOURCE_URL"

mkdir -p "$SCRIPT_DIR/build/bin"
rm -rf "$APP_PATH"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fastfileviewer-build.XXXXXX")"
STAGING_DIR="$TMP_ROOT/project"
STAGING_APP_PATH="$STAGING_DIR/build/bin/$APP_NAME.app"

echo "同步公開來源到本機暫存建置目錄..."
mkdir -p "$STAGING_DIR"
rsync -a \
  --exclude '/.git/' \
  --exclude '/.codex-tmp/' \
  --exclude '/.env*' \
  --exclude '.DS_Store' \
  --exclude '._*' \
  --exclude '*.bak' \
  --exclude '/cert/' \
  --exclude '/data/' \
  --exclude '/dist/' \
  --exclude '/build/bin/' \
  "$SCRIPT_DIR/" "$STAGING_DIR/"
cleanup_appledouble "$STAGING_DIR"

echo "建立非沙盒 Wails App..."
(
  cd "$STAGING_DIR"
  "$WAILS_BIN" build -clean -s -ldflags "$BUILD_LDFLAGS"
)
if [[ ! -d "$STAGING_APP_PATH" ]]; then
  echo "建置失敗：找不到 $STAGING_APP_PATH"
  exit 1
fi

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $APP_MARKETING_VERSION" "$STAGING_APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $APP_BUNDLE_VERSION" "$STAGING_APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $APP_BUNDLE_ID" "$STAGING_APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion 12.0" "$STAGING_APP_PATH/Contents/Info.plist"

APP_LICENSE_DIR="$STAGING_APP_PATH/Contents/Resources/Licenses"
mkdir -p "$APP_LICENSE_DIR"
cp "$STAGING_DIR/LICENSE" "$APP_LICENSE_DIR/GPL-3.0.txt"
cp "$STAGING_DIR/THIRD-PARTY-NOTICES.md" "$APP_LICENSE_DIR/THIRD-PARTY-NOTICES.md"
cp "$STAGING_DIR/THIRD-PARTY-LICENSES.txt" "$APP_LICENSE_DIR/THIRD-PARTY-LICENSES.txt"
node "$STAGING_DIR/scripts/write-build-metadata.mjs" \
  "$STAGING_APP_PATH/Contents/Resources/build-metadata.json" \
  "$APP_MARKETING_VERSION" "$BUILD_COMMIT" "$BUILD_TAG" "$BUILD_STATE" "$BUILD_SOURCE_URL"

rm -f "$STAGING_APP_PATH/Contents/embedded.provisionprofile"
cleanup_appledouble "$STAGING_APP_PATH"
cleanup_codesign_artifacts "$STAGING_APP_PATH"
chmod -R u+rwX,go+rX "$STAGING_APP_PATH"
xattr -cr "$STAGING_APP_PATH" 2>/dev/null || true

SIGNING_ARGUMENTS=(--force --deep --sign "$CODESIGN_IDENTITY" --options runtime)
if [[ "$CODESIGN_IDENTITY" == "-" ]]; then
  echo "以 ad-hoc 簽章簽署非沙盒 App..."
else
  echo "使用本機簽章設定簽署..."
  SIGNING_ARGUMENTS+=(--timestamp)
fi
codesign "${SIGNING_ARGUMENTS[@]}" "$STAGING_APP_PATH"
codesign --verify --deep --strict --verbose=2 "$STAGING_APP_PATH"

ditto --norsrc --noextattr --noqtn "$STAGING_APP_PATH" "$APP_PATH"
cleanup_appledouble "$APP_PATH"
xattr -cr "$APP_PATH" 2>/dev/null || true
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo "完成：$APP_PATH"
echo "Bundle ID：$APP_BUNDLE_ID"
echo "來源版本：$BUILD_TAG ($BUILD_COMMIT, $BUILD_STATE)"
if [[ "$CODESIGN_IDENTITY" == "-" ]]; then
  echo "簽章：ad-hoc（僅適合自行建置與驗證）"
else
  echo "簽章：本機 Developer ID 設定"
fi
echo "此建置未啟用 App Sandbox。"
