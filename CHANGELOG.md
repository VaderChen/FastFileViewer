# Changelog

## 1.26.1004 build 0026 — 2026-10-04

### File information display

- Fix clipped file information below the viewer by allowing the footer height to follow its content.
- Wrap the existing information fields in narrow panes and keep image EXIF, video/audio metadata, and the SHA-256 controls visible.
- Keep loading and extended metadata on their own rows, with the checksum control alongside the basic fields when space permits.
- Verify 40 native WebKit layout cases covering image/media metadata, loading states, window sizes, and library widths.

## 1.26.1003 build 2237 — 2026-10-03

### Metadata and camera RAW support

- Added on-demand FFmpeg metadata for video and audio streams, including duration, bitrate, codecs, dimensions, frame rate, sample rate, and channels.
- Added image dimensions, colour model, and common EXIF fields such as camera, lens, capture time, exposure, ISO, focal length, and GPS.
- Added common camera RAW extensions with macOS ImageIO／`sips` conversion for preview when the operating system supports the camera model.
- Expanded RAW filename detection to additional vendor formats including CRW, SRW, ERF, MRW, GPR, R3D, FFF, BAY, CAP, PTX, and PXN.
- Added selectable Finder association icon styles (`classic`, `monochrome`, and `vivid`) with separate document, image, media/subtitle, and archive icons.
- Separated programming-language formats from document formats in Settings while preserving saved format selections.

### Performance and updates

- Avoid full-path allocations for unsupported files during scans and parse in-memory HLS playlists without a Scanner buffer or per-line copies.
- Reuse unchanged download/update state, transfer compact update progress without repeating release notes, and retain existing cancellation and stale-response handling.
- Precompute numeric table-sort keys and bypass sorting for already ordered numeric columns while preserving stable numeric/locale comparison behavior.
- Add comparative function benchmarks and regression coverage for scan results, HLS boundaries, table ordering, and update polling.
- Check GitHub for a newer stable release at startup and from the About page.
- Show an update confirmation dialog, download progress, and an independent installation progress window while the app closes and restarts.
- Verify package size, SHA-256, macOS compatibility, release metadata, and the installed publisher's code-signing identity before replacing the app; retain the previous bundle until the new UI starts and attempt rollback on failure.
- Support both legacy revision tags and the `1.YY.MMDD-build-HHmm` release format.

## 1.26.1003-r2 — 2026-10-03

### Performance and memory

- Reuse normalized extensions during scans and entry creation; construct archive-directory paths only when a new node is needed.
- Normalize line endings with one output allocation and decode UTF-16 directly without complete code-unit and rune intermediates.
- Reuse one copy buffer per HLS download, choose the highest-bandwidth variant in one pass, and reduce URL and attribute parsing allocations.
- Precompute audio-spectrum sampling positions, reuse per-player amplitude arrays, and read only the analyser data required by the current visualization mode.
- Select matching subtitles in one pass while preserving exact-name, format, locale, and stable-tie priorities.
- Avoid indexing every visible ID during selection updates and reuse unchanged document-highlighting results within the component lifetime.

### Validation and distribution

- Add original-implementation comparisons, function benchmarks, UTF-16 code-unit coverage, HLS error and cancellation checks, and Canvas rendering comparisons.
- Verify 146 frontend tests, 186 Go tests, two fuzz seed suites, race checks, and a further text-compatibility fuzz run.
- Preserve the existing UI, operations, features, authentication, and macOS 12 Apple Silicon support.
- Publish revision `v1.26.1003-r2` with a new build of App version `1.26.1003`; retain the original `v1.26.1003` release.

## 1.26.1003 — 2026-10-03

### Performance and memory

- Reduce repeated library-tree traversal and copying during scans, batch moves, workspace filtering, selection updates, and adjacent-image preparation.
- Keep Finder-prioritized scanning and cancellation behavior while replacing repeated queue sorting with bounded FIFO chunks that release consumed paths.
- Reuse natural-order comparators and avoid redundant table copies; unsorted CSV/TSV filtering retains only the visible rows and the existing truncation indicator.
- Reduce allocations during filename sorting, duplicate detection, small bounded reads, PNG thumbnail encoding, and thumbnail-cache updates.
- Keep thumbnail and archive caches bounded, stream local full-size images, and release obsolete asynchronous work and media resources promptly.

### Reliability

- Preserve stable ordering and supported Unicode filenames while indexing archives and resolving duplicate archive entries.
- Invalidate cached content when its source changes and keep active readers valid until they close.
- Improve cancellation, non-overwriting file completion, redirected download resolution, subtitle conversion, and stale-result handling.

### Documentation and distribution

- Add reproducible performance benchmarks and document their measurement limits.
- Align README, contributor guidance, About license text, and build metadata with the existing project license in `LICENSE.md`.
- Preserve the existing interface layout, controls, supported workflows, authentication behavior, and macOS 12 Apple Silicon target.

## 1.26.0830

### System file opening and startup performance

- Added a fast path for files opened by Finder or the macOS `open` command: the requested file is registered and displayed before the complete directory scan begins.
- Preserved the selected file while the containing directory is indexed in the background, including directories on external volumes.
- Avoided restoring a previous library cache before handling a system-open request, preventing large cached trees from delaying the first document frame.
- Added command-line argument handling for direct launches so cold starts and existing App instances use the same file-open path.

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
