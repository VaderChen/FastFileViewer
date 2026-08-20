# Changelog

## 1.26.0820

### Media and subtitles

- Added local video and audio playback with seekable byte-range delivery.
- Added playback for media stored inside ZIP, TAR, TGZ, and TAR.GZ archives through bounded temporary extraction.
- Added automatic sidecar subtitle matching for same-name and language-suffixed files.
- Added WebVTT conversion for VTT, SRT, ASS, SSA, SMI, and text-based SUB subtitles.
- Added independent media and subtitle format settings for folder and archive scans.
- Added GB18030 document and subtitle decoding while retaining Big5 and Shift-JIS detection.

### Viewer and reliability

- Replaced native video controls with a custom control bar that does not dim the video on pointer hover.
- Added play/pause, ten-second seeking, timeline, volume, subtitle toggle, keyboard controls, and fullscreen actions.
- Fixed GitHub Dark and other syntax themes so background and token colours update together.
- Prevented video and audio files from entering the text-document loader while keeping subtitles readable as text.
- Added backend range, archive-media, subtitle conversion, filtering, encoding, and frontend build coverage.

## 1.26.0815

### Open source release preparation

- Renamed the project and application to FastFileViewer.
- Changed the Go module path to `github.com/VaderChen/FastFileViewer`.
- Changed the default public-build Bundle ID to `com.vader.fastfileviewer`.
- Added GPLv3 and optional commercial dual-license documentation.
- Added third-party dependency inventory and complete license generation.
- Added source revision, tag, build state, source URL, and license information to About and build artifacts.
- Replaced App Store packaging with a reproducible, non-sandbox macOS source-build workflow.
- Added Traditional Chinese, English, and Japanese GitHub documentation.

### Viewer and workspace

- Added unified browsing for images, text, Markdown, source code, structured data, and archive contents.
- Added Markdown rendering, syntax highlighting, JSON tree view, and searchable/sortable CSV/TSV tables.
- Added a three-pane workspace, persistent pinned folders, filters, multi-item export, SHA-256 checks, and exact duplicate detection.
- Added persistent library and thumbnail caches, bounded full-image LRU, adjacent-image preloading, and cancellable operations.
- Added UTF-8, UTF-16, Big5, GBK, Shift-JIS, Windows-1252 fallback, and normalized line ending handling.
- Added image safety limits, document rendering limits, offline Markdown restrictions, and binary-content detection.
