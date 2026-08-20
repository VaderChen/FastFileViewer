<div align="center">
  <img src="assets/appicon.png" alt="FastFileViewer icon" width="128" />
  <h1>FastFileViewer</h1>
  <p>An offline macOS content workspace built with Go, Wails, React, and TypeScript.</p>
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
- Play common video and audio formats with seeking, volume, fullscreen, and keyboard controls.
- Automatically attach matching VTT, SRT, ASS, SSA, SMI, and text-based SUB sidecar subtitles.
- Configure image, document, media, and subtitle scan formats independently.
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

The output is `build/bin/FastFileViewer.app`. The build runs Go and frontend verification and bundles GPLv3, complete third-party license texts, notices, and traceable Git build metadata under `Contents/Resources`.

Prebuilt downloads and SHA-256 checksum files are available from [GitHub Releases](https://github.com/VaderChen/FastFileViewer/releases).

## Privacy and Security

All processing stays local. FastFileViewer does not execute displayed source code or raw Markdown HTML and does not load remote Markdown resources. Do not commit `cert/`, `.env*`, signing assets, packages, personal files, or unredacted debug data. See [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 VaderChen.

FastFileViewer is dual-licensed:

1. Open source use under the [GNU General Public License v3.0](LICENSE).
2. A separate [commercial license](COMMERCIAL-LICENSE.md) for use cases that cannot comply with GPLv3 or require different commercial terms.

Third-party components remain under their own terms. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Until a Contributor License Agreement is available, the project accepts issues and design discussions but does not merge external code contributions; see [CONTRIBUTING.md](CONTRIBUTING.md).
