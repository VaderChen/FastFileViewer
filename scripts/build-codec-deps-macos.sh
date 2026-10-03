#!/bin/zsh

set -euo pipefail

# Build the codec dependencies with the same minimum OS as the app.
SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
PREFIX="${CODEC_PREFIX:-$PROJECT_DIR/third_party/codecs}"
SOURCE_ROOT="${CODEC_SOURCE_ROOT:-${TMPDIR:-/tmp}/fastfileviewer-codec-source}"
CONFIGURE_PREFIX="/fastfileviewer/codecs"
OPUS_VERSION="1.6.1"
VPX_VERSION="1.16.0"

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  print -u2 "Codec dependencies require Apple Silicon macOS."
  exit 1
fi
for command_name in curl tar cmake make clang shasum install_name_tool codesign; do
  command -v "$command_name" >/dev/null || { print -u2 "Missing: $command_name"; exit 1; }
done
if [[ -e "$PREFIX.bak" ]]; then
  print -u2 "Existing backup must be checked before replacing codec dependencies."
  exit 1
fi

mkdir -p "$SOURCE_ROOT"
SOURCE_ROOT="${SOURCE_ROOT:A}"
STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fastfileviewer-codecs.XXXXXX")"
trap 'rm -rf -- "$STAGE_ROOT"' EXIT
INSTALL_PREFIX="$STAGE_ROOT$CONFIGURE_PREFIX"
COMPILER_FLAGS_FILE="$STAGE_ROOT/compiler-flags.rsp"
for source_path in "$SOURCE_ROOT" "$PROJECT_DIR" "${HOME:-}"; do
  [[ -n "$source_path" ]] || continue
  compiler_flag="-ffile-prefix-map=$source_path=source"
  compiler_flag="${compiler_flag//\\/\\\\}"
  compiler_flag="${compiler_flag//\"/\\\"}"
  printf '"%s"\n' "$compiler_flag" >> "$COMPILER_FLAGS_FILE"
done

download_source() {
  local filename="$1" checksum="$2" url="$3"
  if [[ ! -s "$SOURCE_ROOT/$filename" ]]; then
    curl --fail --location --retry 3 --output "$SOURCE_ROOT/$filename" "$url"
  fi
  (cd "$SOURCE_ROOT" && printf '%s  %s\n' "$checksum" "$filename" | shasum -a 256 -c -)
}
download_source "opus-$OPUS_VERSION.tar.gz" \
  6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1 \
  "https://downloads.xiph.org/releases/opus/opus-$OPUS_VERSION.tar.gz"
download_source "libvpx-$VPX_VERSION.tar.gz" \
  7a479a3c66b9f5d5542a4c6a1b7d3768a983b1e5c14c60a9396edc9b649e015c \
  "https://codeload.github.com/webmproject/libvpx/tar.gz/refs/tags/v$VPX_VERSION"

# Extract into a fresh build directory so repeated runs never reuse stale objects.
tar -xzf "$SOURCE_ROOT/opus-$OPUS_VERSION.tar.gz" -C "$STAGE_ROOT"
tar -xzf "$SOURCE_ROOT/libvpx-$VPX_VERSION.tar.gz" -C "$STAGE_ROOT"
compiler_flag="-ffile-prefix-map=$STAGE_ROOT=source"
compiler_flag="${compiler_flag//\\/\\\\}"
compiler_flag="${compiler_flag//\"/\\\"}"
printf '"%s"\n' "$compiler_flag" >> "$COMPILER_FLAGS_FILE"
export MACOSX_DEPLOYMENT_TARGET=12.0
JOBS="$(sysctl -n hw.ncpu)"

cmake -S "$STAGE_ROOT/opus-$OPUS_VERSION" -B "$STAGE_ROOT/opus-build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 -DCMAKE_INSTALL_PREFIX="$CONFIGURE_PREFIX" \
  -DCMAKE_INSTALL_NAME_DIR=@rpath -DCMAKE_C_FLAGS="@$COMPILER_FLAGS_FILE" \
  -DOPUS_BUILD_SHARED_LIBRARY=ON -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_BUILD_TESTING=OFF
cmake --build "$STAGE_ROOT/opus-build" --parallel "$JOBS"
DESTDIR="$STAGE_ROOT" cmake --install "$STAGE_ROOT/opus-build"

mkdir "$STAGE_ROOT/vpx-build"
cd "$STAGE_ROOT/vpx-build"
CFLAGS="-mmacosx-version-min=12.0 @$COMPILER_FLAGS_FILE" \
  CXXFLAGS="-mmacosx-version-min=12.0 @$COMPILER_FLAGS_FILE" \
  LDFLAGS="-mmacosx-version-min=12.0" \
  "$STAGE_ROOT/libvpx-$VPX_VERSION/configure" \
  --prefix="$CONFIGURE_PREFIX" --target=arm64-darwin21-gcc \
  --enable-shared --disable-static --disable-examples --disable-tools \
  --disable-unit-tests --disable-docs --enable-vp9-highbitdepth
make -j"$JOBS"
make install DESTDIR="$STAGE_ROOT"

mkdir -p "$INSTALL_PREFIX/share/licenses/opus" "$INSTALL_PREFIX/share/licenses/libvpx"
cp "$STAGE_ROOT/opus-$OPUS_VERSION/COPYING" "$INSTALL_PREFIX/share/licenses/opus/"
cp "$STAGE_ROOT/libvpx-$VPX_VERSION/LICENSE" "$INSTALL_PREFIX/share/licenses/libvpx/"
for pc_file in "$INSTALL_PREFIX"/lib/pkgconfig/*.pc; do
  sed -i '' -e 's|/fastfileviewer/codecs|${prefix}|g' \
    -e 's|^prefix=.*|prefix=${pcfiledir}/../..|' "$pc_file"
done
for library in "$INSTALL_PREFIX"/lib/*.dylib; do
  [[ -L "$library" ]] && continue
  install_name_tool -id "@rpath/${library:t}" "$library"
  codesign --force --sign - "$library"
done

mkdir -p "${PREFIX:h}"
[[ ! -e "$PREFIX" ]] || mv "$PREFIX" "$PREFIX.bak"
if ! mv "$INSTALL_PREFIX" "$PREFIX"; then
  [[ ! -e "$PREFIX.bak" || -e "$PREFIX" ]] || mv "$PREFIX.bak" "$PREFIX"
  exit 1
fi
[[ ! -d "$PREFIX.bak" ]] || rm -rf -- "$PREFIX.bak"
print "Built Opus $OPUS_VERSION and libvpx $VPX_VERSION for macOS 12 arm64."
