<div align="center">
  <img src="assets/appicon.png" alt="FastFileViewer icon" width="128" />
  <h1>FastFileViewer</h1>
  <p>A local-first macOS file workspace built with Go, Wails, React, and TypeScript.</p>
</div>

<p align="center">
  <a href="README.md">繁體中文</a> |
  <a href="README.en.md">English</a> |
  <a href="README.ja.md">日本語</a>
</p>

## Latest release

[1.26.1004 build 0026](https://github.com/VaderChen/FastFileViewer/releases/tag/1.26.1004-build-0026) fixes clipped file information at the bottom of the viewer. The information area now grows with its content and wraps in narrow panes, keeping image EXIF, media details, and SHA-256 controls visible. Requires Apple Silicon and macOS 12 or later. Choose **Check for Updates** in About to install the new release.

See the [changelog](CHANGELOG.md), [release notes](doc/release-1.26.1004-build-0026.md), [function review](doc/function-optimization-followup.md), and [benchmarks and measurement limits](doc/performance.md).

## Features

- Incrementally scan local folders into a unified tree of images, documents, source code, media, and subtitles.
- Browse supported content inside ZIP, TAR, TGZ, and TAR.GZ archives without extracting them.
- Preview common image, text, Markdown, structured-data, configuration, and source-code formats.
- Preview common camera RAW files (DNG, CRW/CR2/CR3, NEF/NRW, ARW/SRF/SR2, RAF, ORF, RW2, PEF, SRW, ERF, MRW, GPR, R3D, FFF, 3FR, IIQ, and X3F) through macOS ImageIO when the camera model is supported by the operating system.
- Finder-associated files use category icons distinct from the App icon; documents, images, media/subtitles, and archives are separated. Choose a built-in style at build time with `FASTFILEVIEWER_FILE_ICON_STYLE=classic|monochrome|vivid ./build.command`.
- Render Markdown, syntax-highlight code, browse JSON trees, and search or sort CSV/TSV tables.
- Documents use `GitHub Light` by default; other themes are available and the selection is remembered locally.
- Play common video and music formats; choose spectrum bars, waveform, or both visualizations, with the selection remembered locally.
- The `Colors` control slowly cycles spectrum BARs through orange, yellow, green, cyan, blue, and violet-blue; when disabled, BARs remain fixed green.
- Keep music time, play/pause, volume, and mute state while browsing other images or documents; background music pauses when a video is selected.
- Automatically advance to the next audio track after playback ends, skipping non-audio entries and wrapping through the current library order.
- Spectrum bars use logarithmic centre-frequency interpolation over a 32768-point floating-decibel FFT and cover 10 Hz–20 kHz when the source sample rate permits.
- Audio support covers MP2/MP3, M4A/M4B/ALAC, WAV, AAC, FLAC, OGG/OPUS, AIFF, CAF, WMA, APE, WavPack, AC-3, AMR, and MKA.
- FLAC uses native WebKit decoding first and automatically falls back to a temporary compatible M4A when native decoding fails.
- Release apps bundle an LGPL FFmpeg build for automatic temporary MP4 remuxing or transcoding; development mode falls back to a local `ffmpeg` when no bundle is present.
- After a successful MKV remux, optionally save the playable file beside the original and move the original to the Trash so future playback needs no conversion.
- Automatically attach matching VTT, SRT, ASS, SSA, SMI, and text-based SUB sidecar subtitles.
- Paste or drop a public HTTP/HTTPS URL into Downloads to fetch images, videos, articles, and regular files; directly accessible video pages resolve `.m3u8` URLs from HTML and inline scripts.
- A single embedded `.m3u8` starts automatically; multiple candidates open a multi-select dialog and create one download per selection.
- Download unencrypted, completed `.m3u8` VOD playlists; master playlists select and merge the highest-bandwidth variant.
- Configure image, document, programming-language, and media/subtitle scan formats independently.
- Use a three-pane workspace with persistent pinned folders, batch loading, and cancellable operations.
- Export selections across folders and archives, calculate SHA-256, and detect byte-identical duplicates.
- Persist library indexes, thumbnails, and adjacent-image caches locally without a network service.
- Traditional Chinese, English, and Japanese interfaces.

## Public Source Edition

The public source edition does not use StoreKit or App Sandbox and does not contain local release credentials or machine-specific settings. It can access files already available to the current user account, while macOS may still request access to privacy-protected locations.

## Requirements

- Apple Silicon Mac with macOS 12 or later
- Go 1.26.6 or a compatible version
- Node.js and npm
- Xcode Command Line Tools
- CMake and `pkg-config` (required to build bundled codec dependencies; install with `brew install cmake pkg-config`)

## Development

```bash
git clone https://github.com/VaderChen/FastFileViewer.git
cd FastFileViewer
./run.sh
```

The development script runs Wails directly in the project directory. Frontend dependencies are installed in `frontend/node_modules`, and the pinned Wails CLI is installed in `build/tools`.

## Build

```bash
./scripts/build-codec-deps-macos.sh
./scripts/build-ffmpeg-macos.sh
./build.sh
```

Codec dependencies are built from source for macOS 12 into `third_party/codecs` and `third_party/ffmpeg`. App packaging rejects libraries requiring a newer macOS.

The output is `dist/FastFileViewer.app`. The build runs Go and frontend verification and bundles the project license, complete third-party license texts, notices, and traceable Git build metadata under `Contents/Resources`.

Prebuilt downloads are available from [GitHub Releases](https://github.com/VaderChen/FastFileViewer/releases).

The app checks for a newer stable GitHub release at startup. You can also use **Settings → About → Check for Updates**. When an update is available, review its version and notes, then choose **Update and Restart**. Download progress appears in the app; an independent progress window stays open while the app closes, installs, and restarts. Downloads and preparation can be cancelled. The previous bundle is retained until the new UI starts, with rollback attempted on failure. Automatic installation requires an officially signed Apple Silicon app in a writable location; copy the app out of the DMG into Applications first.

## Privacy and Security

Scanning, rendering, thumbnails, playback, and content analysis stay local. Startup and manual update checks contact GitHub for public release metadata; installer downloads start only after confirmation. No local files, directory paths, or account credentials are sent. The Downloads feature connects to public HTTP/HTTPS URLs explicitly pasted or dropped by the user. The downloader does not use browser cookies, login state, or custom credentials; it does not support DRM, paywalls, encrypted HLS, or live HLS. The page resolver does not execute JavaScript: it scans at most 32 MB of HTML and inline script text, returns at most 16 `.m3u8` candidates, and sends only a query-free Referer/Origin derived from the source page. Sites that require browser cookies, login, or anti-bot verification are not bypassed and require a direct `.m3u8` URL. Localhost, private, link-local, and other non-public network addresses are rejected on every request and redirect. Downloads are limited to 4 GB per file and are saved under `~/Downloads/FastFileViewer`.

FastFileViewer does not execute displayed source code or raw Markdown HTML and does not load remote Markdown resources. Do not commit `.env*`, packages, personal files, or unredacted debug data. See [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 VaderChen.

FastFileViewer uses the [Source-Available, No-Commercial-Sales License 1.1](LICENSE.en.md). Non-sale use, modification, and free sharing, including internal organizational use, are allowed subject to its full terms. See the [licensing policy](COMMERCIAL-LICENSE.md) for separate-license inquiries.

This is a custom source-available license with commercial-sales restrictions. Third-party components remain under their own terms. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Until a Contributor License Agreement is available, the project accepts issues and design discussions but does not merge external code contributions; see [CONTRIBUTING.md](CONTRIBUTING.md).
