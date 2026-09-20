#!/bin/zsh

set -euo pipefail

# 依 FFmpeg macOS Compilation Guide 建立可重新連結的 LGPL 動態版本。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FFMPEG_VERSION="${FFMPEG_VERSION:-8.1.2}"
PREFIX="${FFMPEG_PREFIX:-$PROJECT_DIR/third_party/ffmpeg}"
PREFIX_BACKUP="$PREFIX.bak"
CONFIGURE_PREFIX="/fastfileviewer/ffmpeg"
SOURCE_ROOT="${FFMPEG_SOURCE_ROOT:-${TMPDIR:-/tmp}/fastfileviewer-ffmpeg-source}"
ARCHIVE="$SOURCE_ROOT/ffmpeg-$FFMPEG_VERSION.tar.xz"
SOURCE_DIR="$SOURCE_ROOT/ffmpeg-$FFMPEG_VERSION"

for command_name in curl tar make clang pkg-config; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少 FFmpeg 建置必要指令：$command_name"
    exit 1
  fi
done

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "此 FFmpeg 建置腳本只支援 Apple Silicon macOS。"
  exit 1
fi
if ! pkg-config --exists opus vpx; then
  echo "找不到 libopus 或 libvpx；請依官方 macOS 指南先安裝相依套件。"
  exit 1
fi

mkdir -p "$SOURCE_ROOT"
if [[ ! -d "$SOURCE_DIR" ]]; then
  if [[ ! -s "$ARCHIVE" ]]; then
    echo "下載 FFmpeg $FFMPEG_VERSION 原始碼..."
    curl --fail --location --retry 3 --output "$ARCHIVE" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
  fi
  tar -xJf "$ARCHIVE" -C "$SOURCE_ROOT"
fi

if [[ -e "$PREFIX_BACKUP" ]]; then
  echo "備份目錄已存在，請先確認後移除：$PREFIX_BACKUP"
  exit 1
fi
STAGE_ROOT="$(mktemp -d /tmp/fastfileviewer-ffmpeg-install.XXXXXX)"
INSTALL_PREFIX="$STAGE_ROOT$CONFIGURE_PREFIX"
COMPILER_FLAGS_FILE="$STAGE_ROOT/compiler-flags.rsp"
trap 'rm -rf "$STAGE_ROOT"' EXIT

# configure 參數會存入執行檔；本機路徑對映只透過編譯環境傳入。
# Clang response 檔可保留來源目錄中的空白與引號。
append_source_map() {
  local source_path="$1" public_path="$2" compiler_flag
  [[ -n "$source_path" ]] || return 0
  compiler_flag="-ffile-prefix-map=$source_path=$public_path"
  compiler_flag="${compiler_flag//\\/\\\\}"
  compiler_flag="${compiler_flag//\"/\\\"}"
  printf '"%s"\n' "$compiler_flag" >> "$COMPILER_FLAGS_FILE"
}
append_source_map "${HOME:-}" "home"
append_source_map "$PROJECT_DIR" "fastfileviewer"
append_source_map "${PROJECT_DIR:A}" "fastfileviewer"
append_source_map "$SOURCE_DIR" "ffmpeg"
append_source_map "${SOURCE_DIR:A}" "ffmpeg"

cd "$SOURCE_DIR"
if [[ -f ffbuild/config.mak ]]; then
  make distclean
fi
CPPFLAGS="${CPPFLAGS:-} @$COMPILER_FLAGS_FILE" ./configure \
  --prefix="$CONFIGURE_PREFIX" \
  --install-name-dir=@rpath \
  --arch=arm64 \
  --target-os=darwin \
  --cc=clang \
  --enable-shared \
  --disable-static \
  --disable-debug \
  --disable-doc \
  --disable-ffplay \
  --disable-network \
  --disable-autodetect \
  --disable-everything \
  --enable-ffmpeg \
  --enable-ffprobe \
  --enable-protocol=file,pipe \
  --enable-demuxer=matroska,mov,avi,mpegts,mp3,wav,flac,ac3,ape,wv,amr,aac,ogg,caf,asf \
  --enable-muxer=mp4,webm,matroska,mpegts,adts,ipod,wav,ogg,oga,flac \
  --enable-decoder=h264,hevc,vp8,vp9,av1,aac,mp3,flac,alac,ac3,wmav1,wmav2,ape,wavpack,pcm_s16le,pcm_s24le,pcm_s32le,opus,vorbis,amrnb,amrwb \
  --enable-encoder=aac,h264_videotoolbox,libopus,libvpx_vp8,libvpx_vp9,pcm_s16le \
  --enable-parser=aac,ac3,ape,flac,h264,hevc,mpegaudio,opus,vp8,vp9,vorbis \
  --enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata,vp9_superframe \
  --enable-filter=aresample,format,scale \
  --pkg-config-flags=--static \
  --enable-videotoolbox \
  --enable-audiotoolbox \
  --enable-libopus \
  --enable-libvpx \
  --extra-cflags="-mmacosx-version-min=12.0" \
  --extra-ldflags="-mmacosx-version-min=12.0 -Wl,-rpath,@executable_path/../lib"
make -j"$(sysctl -n hw.ncpu)"
make install DESTDIR="$STAGE_ROOT"

mkdir -p "$INSTALL_PREFIX/share/licenses/ffmpeg"
cp COPYING.LGPLv2.1 "$INSTALL_PREFIX/share/licenses/ffmpeg/COPYING.LGPLv2.1"
mkdir -p "$INSTALL_PREFIX/share/licenses/opus" "$INSTALL_PREFIX/share/licenses/libvpx"
OPUS_LIB_DIR="$(pkg-config --variable=libdir opus)"
VPX_LIB_DIR="$(pkg-config --variable=libdir vpx)"
cp "$OPUS_LIB_DIR/libopus.0.dylib" "$INSTALL_PREFIX/lib/"
cp "$VPX_LIB_DIR/libvpx.12.dylib" "$INSTALL_PREFIX/lib/"
curl --fail --location --retry 3 --output "$INSTALL_PREFIX/share/licenses/opus/COPYING" \
  "https://raw.githubusercontent.com/xiph/opus/v1.6.1/COPYING"
curl --fail --location --retry 3 --output "$INSTALL_PREFIX/share/licenses/libvpx/LICENSE" \
  "https://raw.githubusercontent.com/webmproject/libvpx/v1.16.0/LICENSE"

if [[ ! -x "$INSTALL_PREFIX/bin/ffmpeg" || ! -x "$INSTALL_PREFIX/bin/ffprobe" ]]; then
  echo "FFmpeg 建置完成但找不到 ffmpeg/ffprobe。"
  exit 1
fi
mkdir -p "$(dirname "$PREFIX")"
if [[ -e "$PREFIX" ]]; then
  mv "$PREFIX" "$PREFIX_BACKUP"
fi
if ! mv "$INSTALL_PREFIX" "$PREFIX"; then
  if [[ -e "$PREFIX_BACKUP" && ! -e "$PREFIX" ]]; then
    mv "$PREFIX_BACKUP" "$PREFIX"
  fi
  echo "無法安裝 FFmpeg，請確認目的地與備份目錄。"
  exit 1
fi
echo "完成 LGPL FFmpeg：$PREFIX"
echo "版本：$FFMPEG_VERSION"
echo "configure：未啟用 --enable-gpl、--enable-nonfree、libx264、libx265 或 libxvid"
if [[ -d "$PREFIX_BACKUP" ]]; then
  find "$PREFIX_BACKUP" -depth -delete
fi
