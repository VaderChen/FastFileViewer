#!/bin/zsh

set -euo pipefail

# 依 FFmpeg macOS Compilation Guide 建立可重新連結的 LGPL 動態版本。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FFMPEG_VERSION="${FFMPEG_VERSION:-8.1.2}"
PREFIX="${FFMPEG_PREFIX:-$PROJECT_DIR/third_party/ffmpeg}"
PREFIX_BACKUP="$PREFIX.bak"
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
if [[ -e "$PREFIX" ]]; then
  mv "$PREFIX" "$PREFIX_BACKUP"
fi
mkdir -p "$PREFIX"

cd "$SOURCE_DIR"
if [[ -f ffbuild/config.mak ]]; then
  make distclean
fi
./configure \
  --prefix="$PREFIX" \
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
make install

mkdir -p "$PREFIX/share/licenses/ffmpeg"
cp COPYING.LGPLv2.1 "$PREFIX/share/licenses/ffmpeg/COPYING.LGPLv2.1"
mkdir -p "$PREFIX/share/licenses/opus" "$PREFIX/share/licenses/libvpx"
OPUS_LIB_DIR="$(pkg-config --variable=libdir opus)"
VPX_LIB_DIR="$(pkg-config --variable=libdir vpx)"
cp "$OPUS_LIB_DIR/libopus.0.dylib" "$PREFIX/lib/"
cp "$VPX_LIB_DIR/libvpx.12.dylib" "$PREFIX/lib/"
curl --fail --location --retry 3 --output "$PREFIX/share/licenses/opus/COPYING" \
  "https://raw.githubusercontent.com/xiph/opus/v1.6.1/COPYING"
curl --fail --location --retry 3 --output "$PREFIX/share/licenses/libvpx/LICENSE" \
  "https://raw.githubusercontent.com/webmproject/libvpx/v1.16.0/LICENSE"

if [[ ! -x "$PREFIX/bin/ffmpeg" || ! -x "$PREFIX/bin/ffprobe" ]]; then
  echo "FFmpeg 建置完成但找不到 ffmpeg/ffprobe。"
  exit 1
fi
echo "完成 LGPL FFmpeg：$PREFIX"
echo "版本：$FFMPEG_VERSION"
echo "configure：未啟用 --enable-gpl、--enable-nonfree、libx264、libx265 或 libxvid"
if [[ -d "$PREFIX_BACKUP" ]]; then
  find "$PREFIX_BACKUP" -depth -delete
fi
