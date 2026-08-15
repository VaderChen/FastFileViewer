# Changelog

## 1.26.0815

### Open source release preparation

- Renamed the project and application to FastFileViewer.
- Changed the Go module path to `github.com/VaderChen/FastFileViewer`.
- Changed the default public-build Bundle ID to `com.vader.fastfileviewer`.
- Added GPLv3 and optional commercial dual-license documentation.
- Added third-party dependency inventory and complete license generation.
- Added source revision, tag, build state, source URL, and license information to About and build artifacts.
- Replaced App Store packaging with an ad-hoc, non-sandbox macOS source-build workflow.
- Added Traditional Chinese, English, and Japanese GitHub documentation.

### Viewer and workspace

- Added unified browsing for images, text, Markdown, source code, structured data, and archive contents.
- Added Markdown rendering, syntax highlighting, JSON tree view, and searchable/sortable CSV/TSV tables.
- Added a three-pane workspace, persistent pinned folders, filters, multi-item export, SHA-256 checks, and exact duplicate detection.
- Added persistent library and thumbnail caches, bounded full-image LRU, adjacent-image preloading, and cancellable operations.
- Added UTF-8, UTF-16, Big5, GBK, Shift-JIS, Windows-1252 fallback, and normalized line ending handling.
- Added image safety limits, document rendering limits, offline Markdown restrictions, and binary-content detection.
