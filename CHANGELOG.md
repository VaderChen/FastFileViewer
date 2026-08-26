# Changelog

## 1.26.0825

### Architecture and playback workflow

- Split the Wails bindings into independent library, media, and download services so their lifecycle state and cancellation resources are isolated.
- Extracted image viewing, workspace, downloads, thumbnail cards, formatting, and operation handling into reusable frontend modules without changing their user-facing behavior.
- Added an optional post-remux cleanup flow for MKV playback: save the playable remux beside the source and move the original to the Trash, or keep the original and use the temporary playback cache.
- Corrected the developer documentation to describe the 32768-point audio FFT, current service boundaries, and current FastFileViewer packaging model.
- Moved the default App Bundle output to `dist/FastFileViewer.app` and aligned the DMG/App Store packaging scripts and App Store Bundle ID with the current product name.

## 1.26.0824

### Downloads and media compatibility

- Added a real-time music visualizer with selectable spectrum bars, waveform, or combined rendering powered by the Web Audio API.
- Changed spectrum mapping to 72 logarithmic centre frequencies with linear interpolation over a 32768-point floating-decibel FFT from 18 Hz to 24 kHz when the source sample rate permits, while bounding waveform drawing to 1,600 points.
- Preserved music time, play/pause, volume, and mute state while navigating images and documents, and paused retained audio when selecting a video.
- Added automatic next-track playback that skips non-audio entries and wraps through the current library order.
- Added an interactive-latency Web Audio output gain stage so native mute changes silence playback immediately.
- Expanded audio support to MP2/MP3, M4A/M4B/ALAC, WAV, AAC, FLAC, OGG/OPUS, AIFF, CAF, WMA, APE, WavPack, AC-3, AMR, and MKA.
- Added native-first FLAC playback with automatic temporary M4A fallback when WebKit cannot decode the source.
- Added eager `ffmpeg` compatibility conversion for WMA, APE, WavPack, standalone ALAC, AC-3, and AMR audio.
- Added a Downloads source tab with automatic URL paste and drag-and-drop handling, queue progress, cancellation, persistent history, record removal, and Finder actions.
- Added direct downloads for public HTTP/HTTPS images, videos, articles, and files under `~/Downloads/FastFileViewer`.
- Added generic video-page resolution for `.m3u8` URLs embedded in HTML or inline scripts, including escaped and relative URLs without executing page JavaScript.
- Added a multi-select dialog when a page exposes multiple HLS candidates; each selected stream becomes an independent cancellable download.
- Added unencrypted, completed `.m3u8` VOD support with highest-bandwidth master-playlist selection, relative URLs, initialization segments, byte ranges, and bounded segment merging.
- Added SSRF and DNS-rebinding defenses that reject localhost, private, link-local, multicast, CGNAT, and reserved addresses on initial requests, redirects, and connection-time DNS resolution.
- Added download size limits, non-overwriting atomic completion, cancellation cleanup, and local queue persistence without cookies or credentials.
- Added optional MKV playback through a locally installed `ffmpeg`, using MP4 remuxing first and VideoToolbox transcoding as a fallback.
- Updated the product description from offline-only to local-first: viewing and rendering remain local, while network access occurs only after an explicit download action.

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
