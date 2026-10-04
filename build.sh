#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
APP_NAME="FastFileViewer"
APP_OUTPUT_DIR="${APP_OUTPUT_DIR:-$SCRIPT_DIR/dist}"
APP_PATH="$APP_OUTPUT_DIR/$APP_NAME.app"
APP_ICON_SOURCE="$SCRIPT_DIR/assets/appicon.png"
FILE_ICON_STYLE="${FASTFILEVIEWER_FILE_ICON_STYLE:-classic}"
FILE_ICON_STYLES_DIR="$SCRIPT_DIR/assets/file-icons"
FFMPEG_BIN_DIR="${FASTFILEVIEWER_FFMPEG_BIN_DIR:-$SCRIPT_DIR/third_party/ffmpeg/bin}"

BUILD_APP_PATH="$SCRIPT_DIR/build/bin/$APP_NAME.app"

export MACOSX_DEPLOYMENT_TARGET="12.0"
export CGO_CFLAGS="-mmacosx-version-min=12.0"
export CGO_LDFLAGS="-mmacosx-version-min=12.0"

CODESIGN_IDENTITY="${CODESIGN_IDENTITY:--}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.vader.fastfileviewer}"
BUILD_SOURCE_URL="${BUILD_SOURCE_URL:-https://github.com/VaderChen/FastFileViewer}"
APP_BUILD_TIMESTAMP="$(date '+1.%y.%m%d %H%M')"
APP_MARKETING_VERSION="${APP_MARKETING_VERSION:-${APP_BUILD_TIMESTAMP% *}}"
APP_BUILD_LABEL="${APP_BUILD_LABEL:-${APP_BUILD_TIMESTAMP##* }}"
APP_DISPLAY_VERSION="$APP_MARKETING_VERSION build $APP_BUILD_LABEL"
APP_BUNDLE_VERSION="${APP_BUNDLE_VERSION:-$APP_MARKETING_VERSION.$APP_BUILD_LABEL}"

if (( $# > 0 )); then
  echo "用法：$0"
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
if [[ ! "$APP_BUILD_LABEL" =~ '^([01][0-9]|2[0-3])[0-5][0-9]$' ]]; then
  echo "APP_BUILD_LABEL 必須為 24 小時制 HHmm：$APP_BUILD_LABEL"
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
if [[ ! -s "$APP_ICON_SOURCE" ]]; then
  echo "找不到 App 圖示：$APP_ICON_SOURCE"
  exit 1
fi
if [[ ! "$FILE_ICON_STYLE" =~ '^[A-Za-z0-9_-]+$' || ! -d "$FILE_ICON_STYLES_DIR/$FILE_ICON_STYLE" ]]; then
  echo "找不到檔案關聯圖示樣式：$FILE_ICON_STYLE"
  echo "可用樣式：$(find "$FILE_ICON_STYLES_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort | tr '\n' ' ')"
  exit 1
fi

export VITE_APP_VERSION="$APP_DISPLAY_VERSION"

cleanup_codesign_artifacts() {
  local target_path="$1"
  if [[ -e "$target_path" ]]; then
    find "$target_path" -name '_CodeSignature' -type d -prune -exec rm -rf {} + 2>/dev/null || true
    find "$target_path" -name 'CodeResources' -type f -delete 2>/dev/null || true
  fi
}

validate_bundled_ffmpeg() {
  local source_dir="$FFMPEG_BIN_DIR"
  local tool license tool_output version_line configuration_line
  if [[ ! -d "$source_dir" ]]; then
    echo "找不到 LGPL FFmpeg：$source_dir"
    echo "請先執行 scripts/build-ffmpeg-macos.sh，或設定 FASTFILEVIEWER_FFMPEG_BIN_DIR。"
    exit 1
  fi
  for tool in ffmpeg ffprobe; do
    if [[ ! -x "$source_dir/$tool" ]]; then
      echo "FFmpeg 目錄缺少可執行檔：$source_dir/$tool"
      exit 1
    fi
    if ! tool_output="$("$source_dir/$tool" -version 2>&1)"; then
      echo "FFmpeg 工具無法執行：$source_dir/$tool"
      echo "$tool_output"
      exit 1
    fi
    version_line="$(printf '%s\n' "$tool_output" | sed -n '1p')"
    if [[ "$version_line" != "$tool version "* ]] ||
      ! printf '%s\n' "$tool_output" | grep '^configuration:' >/dev/null; then
      echo "FFmpeg 版本或組態資訊不完整：$source_dir/$tool"
      exit 1
    fi
    configuration_line="$(printf '%s\n' "$tool_output" | sed -n 's/^configuration: //p')"
    if [[ "$configuration_line" == *"--enable-gpl"* || "$configuration_line" == *"--enable-nonfree"* || "$configuration_line" == *"libx264"* || "$configuration_line" == *"libx265"* || "$configuration_line" == *"libxvid"* ]]; then
      echo "拒絕打包非 LGPL FFmpeg：$version_line"
      echo "請使用未啟用 GPL/nonfree 或 GPL 外部編碼器的建置。"
      exit 1
    fi
    echo "檢查 LGPL FFmpeg：$version_line"
  done
  if [[ ! -d "$source_dir/../lib" ]] || [[ -z "$(find "$source_dir/../lib" -maxdepth 1 -name '*.dylib' -print -quit)" ]]; then
    echo "FFmpeg 目錄缺少動態函式庫：$source_dir/../lib"
    exit 1
  fi
  for license in ffmpeg/COPYING.LGPLv2.1 opus/COPYING libvpx/LICENSE; do
    if [[ ! -s "$source_dir/../share/licenses/$license" ]]; then
      echo "FFmpeg 目錄缺少授權文字：$license"
      exit 1
    fi
  done
}

prepare_bundled_ffmpeg() {
  local source_dir="$FFMPEG_BIN_DIR"
  local resource_dir="$BUILD_APP_PATH/Contents/Resources/bin"
  local resource_lib_dir="$BUILD_APP_PATH/Contents/Resources/lib"
  local library dependency library_id

  mkdir -p "$resource_dir"
  cp "$source_dir/ffmpeg" "$source_dir/ffprobe" "$resource_dir/"
  chmod 755 "$resource_dir/ffmpeg" "$resource_dir/ffprobe"
  mkdir -p "$resource_lib_dir"
  cp -P "$source_dir"/../lib/*.dylib "$resource_lib_dir/"
  cp "$source_dir/../share/licenses/ffmpeg/COPYING.LGPLv2.1" "$APP_LICENSE_DIR/LGPL-2.1-FFmpeg.txt"
  cp "$source_dir/../share/licenses/opus/COPYING" "$APP_LICENSE_DIR/Opus-COPYING.txt"
  cp "$source_dir/../share/licenses/libvpx/LICENSE" "$APP_LICENSE_DIR/libvpx-LICENSE.txt"
  for library in "$resource_lib_dir"/*.dylib(N.); do
    # Preserve the ABI name used by dependents, including versioned symlinks.
    # Hardened dyld requires the requested leaf name to match LC_ID_DYLIB.
    library_id="$(otool -D "$library" | sed -n '2p')"
    if [[ -z "$library_id" || ! -e "$resource_lib_dir/${library_id:t}" ]]; then
      echo "動態函式庫缺少相符的安裝名稱：${library:t}"
      exit 1
    fi
    install_name_tool -id "@rpath/${library_id:t}" "$library"
    while IFS= read -r dependency; do
      [[ -e "$resource_lib_dir/$(basename "$dependency")" ]] || continue
      install_name_tool -change "$dependency" "@rpath/$(basename "$dependency")" "$library"
    done < <(otool -L "$library" | sed -n 's/^[[:space:]]*\([^[:space:]]*\.dylib\).*$/\1/p')
  done
  for tool in ffmpeg ffprobe; do
    install_name_tool -add_rpath '@executable_path/../lib' "$resource_dir/$tool" 2>/dev/null || true
    while IFS= read -r dependency; do
      [[ -e "$resource_lib_dir/$(basename "$dependency")" ]] || continue
      install_name_tool -change "$dependency" "@rpath/$(basename "$dependency")" "$resource_dir/$tool"
    done < <(otool -L "$resource_dir/$tool" | sed -n 's/^[[:space:]]*\([^[:space:]]*\.dylib\).*$/\1/p')
  done
}

required_commands=(go node npm codesign ditto security install_name_tool otool)
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

# Keep the declared macOS deployment target compatible with the Go toolchain.
export GOTOOLCHAIN="$(awk '$1 == "go" { print "go" $2; exit }' "$SCRIPT_DIR/go.mod")"

cd "$SCRIPT_DIR"
WAILS_BIN="$(node "$SCRIPT_DIR/scripts/prepare-wails-cli.mjs")"

echo "依 package-lock.json 安裝前端依賴..."
(cd "$FRONTEND_DIR" && npm ci)

echo "建置前端資產：$APP_DISPLAY_VERSION"
(cd "$FRONTEND_DIR" && npm run build)

echo "驗證 Go 與前端原始碼..."
go mod verify
go vet ./...
go test -race ./...
(cd "$FRONTEND_DIR" && npm test && npm audit --omit=dev)

echo "產生第三方授權清冊..."
node "$SCRIPT_DIR/scripts/generate-third-party-notices.mjs"

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

BUILD_LDFLAGS="-X 'github.com/VaderChen/FastFileViewer/internal/app.appVersion=$APP_DISPLAY_VERSION' -X github.com/VaderChen/FastFileViewer/internal/app.appCommit=$BUILD_COMMIT -X github.com/VaderChen/FastFileViewer/internal/app.appTag=$BUILD_TAG -X github.com/VaderChen/FastFileViewer/internal/app.appBuildState=$BUILD_STATE -X github.com/VaderChen/FastFileViewer/internal/app.appSourceURL=$BUILD_SOURCE_URL"

validate_bundled_ffmpeg
node "$SCRIPT_DIR/scripts/check-macos-target.mjs" \
  "$FFMPEG_BIN_DIR/ffmpeg" "$FFMPEG_BIN_DIR/ffprobe" "$FFMPEG_BIN_DIR"/../lib/*.dylib

echo "準備 App 圖示：$APP_ICON_SOURCE"
mkdir -p "$SCRIPT_DIR/build"
cp "$APP_ICON_SOURCE" "$SCRIPT_DIR/build/appicon.png"
for file_icon in documenticon mediaicon imageicon archiveicon; do
  cp "$FILE_ICON_STYLES_DIR/$FILE_ICON_STYLE/$file_icon.png" "$SCRIPT_DIR/build/$file_icon.png"
done

echo "從專案目錄建立非沙盒 Wails App..."
"$WAILS_BIN" build -clean -s -m -trimpath -nosyncgomod -ldflags "$BUILD_LDFLAGS"
if [[ ! -d "$BUILD_APP_PATH" ]]; then
  echo "建置失敗：找不到 $BUILD_APP_PATH"
  exit 1
fi
if [[ ! -s "$BUILD_APP_PATH/Contents/Resources/iconfile.icns" ]]; then
  echo "建置失敗：App Bundle 缺少 iconfile.icns"
  exit 1
fi

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $APP_MARKETING_VERSION" "$BUILD_APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $APP_BUNDLE_VERSION" "$BUILD_APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $APP_BUNDLE_ID" "$BUILD_APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion 12.0" "$BUILD_APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :NSRemovableVolumesUsageDescription string FastFileViewer 需要讀取外接磁碟中的檔案。" "$BUILD_APP_PATH/Contents/Info.plist" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Set :NSRemovableVolumesUsageDescription FastFileViewer 需要讀取外接磁碟中的檔案。" "$BUILD_APP_PATH/Contents/Info.plist"

APP_LICENSE_DIR="$BUILD_APP_PATH/Contents/Resources/Licenses"
mkdir -p "$APP_LICENSE_DIR"
cp "$SCRIPT_DIR"/LICENSE*.md "$APP_LICENSE_DIR/"
cp "$SCRIPT_DIR/THIRD-PARTY-NOTICES.md" "$APP_LICENSE_DIR/THIRD-PARTY-NOTICES.md"
cp "$SCRIPT_DIR/THIRD-PARTY-LICENSES.txt" "$APP_LICENSE_DIR/THIRD-PARTY-LICENSES.txt"
node "$SCRIPT_DIR/scripts/write-build-metadata.mjs" \
  "$BUILD_APP_PATH/Contents/Resources/build-metadata.json" \
  "$APP_DISPLAY_VERSION" "$BUILD_COMMIT" "$BUILD_TAG" "$BUILD_STATE" "$BUILD_SOURCE_URL"

prepare_bundled_ffmpeg

rm -f "$BUILD_APP_PATH/Contents/embedded.provisionprofile"
cleanup_codesign_artifacts "$BUILD_APP_PATH"
chmod -R u+rwX,go+rX "$BUILD_APP_PATH"
xattr -cr "$BUILD_APP_PATH" 2>/dev/null || true

# 檢查整個 App（包含 FFmpeg），阻止本機路徑或機密進入發行產物。
node "$SCRIPT_DIR/scripts/check-macos-target.mjs" "$BUILD_APP_PATH/Contents/MacOS/$APP_NAME"
node "$SCRIPT_DIR/scripts/check-privacy.mjs" --artifact "$BUILD_APP_PATH"

if [[ -d "$BUILD_APP_PATH/Contents/Resources/bin" ]]; then
  NESTED_SIGNING_ARGUMENTS=(--force --sign "$CODESIGN_IDENTITY" --options runtime)
  FFMPEG_ENTITLEMENTS_ARGUMENTS=()
  if [[ -f "$SCRIPT_DIR/build/darwin/FFmpeg.entitlements.plist" ]]; then
    FFMPEG_ENTITLEMENTS_ARGUMENTS=(--entitlements "$SCRIPT_DIR/build/darwin/FFmpeg.entitlements.plist")
  else
    echo "找不到選用的 FFmpeg entitlements，使用一般簽章流程..."
  fi
  if [[ "$CODESIGN_IDENTITY" != "-" ]]; then
    NESTED_SIGNING_ARGUMENTS+=(--timestamp)
  fi
  for nested_binary in "$BUILD_APP_PATH/Contents/Resources/lib"/*.dylib(N.); do
    codesign "${NESTED_SIGNING_ARGUMENTS[@]}" "$nested_binary"
  done
  for nested_binary in "$BUILD_APP_PATH/Contents/Resources/bin/ffmpeg" "$BUILD_APP_PATH/Contents/Resources/bin/ffprobe"; do
    codesign "${NESTED_SIGNING_ARGUMENTS[@]}" \
      "${FFMPEG_ENTITLEMENTS_ARGUMENTS[@]}" "$nested_binary"
  done
fi

# Resource copies and nested signatures can create fresh ExFAT sidecars after
# Wails has signed the executable. Clean the final bundle immediately before signing.
node "$SCRIPT_DIR/scripts/clean-bundle-metadata.mjs" "$BUILD_APP_PATH"
SIGNING_ARGUMENTS=(--force --deep --sign "$CODESIGN_IDENTITY" --options runtime)
if [[ "$CODESIGN_IDENTITY" == "-" ]]; then
  echo "以 ad-hoc 簽章簽署非沙盒 App..."
else
  echo "使用本機簽章設定簽署..."
  SIGNING_ARGUMENTS+=(--timestamp)
fi
codesign "${SIGNING_ARGUMENTS[@]}" "$BUILD_APP_PATH"
codesign --verify --deep --strict --verbose=2 "$BUILD_APP_PATH"

mkdir -p "$APP_OUTPUT_DIR"
if [[ "${APP_PATH:A}" != "${BUILD_APP_PATH:A}" ]]; then
  rm -rf "$APP_PATH"
  ditto --noqtn "$BUILD_APP_PATH" "$APP_PATH"
fi
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
