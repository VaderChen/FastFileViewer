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

## Features

- Incrementally scan local folders into a unified tree of images, documents, source code, media, and subtitles.
- Browse supported content inside ZIP, TAR, TGZ, and TAR.GZ archives without extracting them.
- Preview common image, text, Markdown, structured-data, configuration, and source-code formats.
- Render Markdown, syntax-highlight code, browse JSON trees, and search or sort CSV/TSV tables.
- Play common video and music formats; choose spectrum bars, waveform, or both visualizations, with the selection remembered locally.
- Keep music time, play/pause, volume, and mute state while browsing other images or documents; background music pauses when a video is selected.
- Automatically advance to the next audio track after playback ends, skipping non-audio entries and wrapping through the current library order.
- Spectrum bars use logarithmic centre-frequency interpolation over a 32768-point floating-decibel FFT and cover 18 Hz–24 kHz when the source sample rate permits.
- Audio support covers MP2/MP3, M4A/M4B/ALAC, WAV, AAC, FLAC, OGG/OPUS, AIFF, CAF, WMA, APE, WavPack, AC-3, AMR, and MKA.
- FLAC uses native WebKit decoding first and automatically falls back to a temporary compatible M4A when native decoding fails.
- Play MKV files through automatic temporary MP4 remuxing or transcoding when a local `ffmpeg` installation is available.
- After a successful MKV remux, optionally save the playable file beside the original and move the original to the Trash so future playback needs no conversion.
- Automatically attach matching VTT, SRT, ASS, SSA, SMI, and text-based SUB sidecar subtitles.
- Paste or drop a public HTTP/HTTPS URL into Downloads to fetch images, videos, articles, and regular files; directly accessible video pages resolve `.m3u8` URLs from HTML and inline scripts.
- A single embedded `.m3u8` starts automatically; multiple candidates open a multi-select dialog and create one download per selection.
- Download unencrypted, completed `.m3u8` VOD playlists; master playlists select and merge the highest-bandwidth variant.
- Configure image, document, and media/subtitle scan formats independently.
- Use a three-pane workspace with persistent pinned folders, batch loading, and cancellable operations.
- Export selections across folders and archives, calculate SHA-256, and detect byte-identical duplicates.
- Persist library indexes, thumbnails, and adjacent-image caches locally without a network service.
- Traditional Chinese, English, and Japanese interfaces.

## Open Source Edition

The public source edition does not use StoreKit or App Sandbox and does not contain local release credentials or machine-specific settings. It can access files already available to the current user account, while macOS may still request access to privacy-protected locations.

## Requirements

- Apple Silicon Mac with macOS 12 or later
- Go 1.26.4 or a compatible version
- Node.js and npm
- Xcode Command Line Tools
- `rsync`
- `ffmpeg` (optional, required for MKV and non-native audio compatibility playback; install with `brew install ffmpeg`)

## Development

```bash
git clone https://github.com/VaderChen/FastFileViewer.git
cd FastFileViewer
./run.sh
```

The development script mirrors the project into a local temporary directory to avoid AppleDouble and external-drive small-file issues.

## Build

```bash
./build.sh
```

The output is `dist/FastFileViewer.app`. The build runs Go and frontend verification and bundles GPLv3, complete third-party license texts, notices, and traceable Git build metadata under `Contents/Resources`.

Prebuilt downloads and SHA-256 checksum files are available from [GitHub Releases](https://github.com/VaderChen/FastFileViewer/releases).

To create a Developer ID-signed and Apple-notarized DMG, run or double-click `package-dmg.command`; with no arguments it uses the existing `dist/FastFileViewer.app`. Use `./package-dmg.command --build` for a formal tagged rebuild, which requires a clean worktree and exact tag. The DMG workflow does not require an App Store provisioning profile and automatically discovers the available `VaderApp` notarytool Keychain Profile.

## Privacy and Security

Scanning, rendering, thumbnails, playback, and content analysis stay local. FastFileViewer only makes an outbound HTTP/HTTPS connection after the user explicitly pastes or drops a URL into Downloads. The downloader does not use browser cookies, login state, or custom credentials; it does not support DRM, paywalls, encrypted HLS, or live HLS. The page resolver does not execute JavaScript: it scans at most 32 MB of HTML and inline script text, returns at most 16 `.m3u8` candidates, and sends only a query-free Referer/Origin derived from the source page. Sites that require browser cookies, login, or anti-bot verification are not bypassed and require a direct `.m3u8` URL. Localhost, private, link-local, and other non-public network addresses are rejected on every request and redirect. Downloads are limited to 4 GB per file and are saved under `~/Downloads/FastFileViewer`.

FastFileViewer does not execute displayed source code or raw Markdown HTML and does not load remote Markdown resources. Do not commit `cert/`, `.env*`, signing assets, packages, personal files, or unredacted debug data. See [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 VaderChen.

FastFileViewer is dual-licensed:

1. Open source use under the [GNU General Public License v3.0](LICENSE).
2. A separate [commercial license](COMMERCIAL-LICENSE.md) for use cases that cannot comply with GPLv3 or require different commercial terms.

Third-party components remain under their own terms. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Until a Contributor License Agreement is available, the project accepts issues and design discussions but does not merge external code contributions; see [CONTRIBUTING.md](CONTRIBUTING.md).
