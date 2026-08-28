FastFileViewer is now a local-first file, media, archive, and download workspace for Apple Silicon Macs. This release adds URL downloads, HLS video-page discovery, broader media compatibility, and real-time music visualization while keeping file browsing and rendering local.

## Highlights

### Downloads and HLS

- Added a Downloads tab with URL paste and drag-and-drop handling, live progress, cancellation, persistent history, record removal, and Finder actions.
- Added direct downloads for public HTTP/HTTPS images, videos, articles, and regular files under `~/Downloads/FastFileViewer`.
- Added video-page discovery for `.m3u8` URLs found in HTML and inline scripts without executing page JavaScript.
- Added a multi-select dialog when a page exposes multiple HLS streams.
- Added unencrypted, completed HLS VOD downloads with master-playlist selection, relative URLs, initialization segments, byte ranges, and bounded segment merging.

### Media Compatibility

- Added optional MKV playback through a locally installed `ffmpeg`, using MP4 remuxing first and VideoToolbox transcoding as a fallback.
- Expanded audio support to MP2/MP3, M4A/M4B/ALAC, WAV, AAC, FLAC, OGG/OPUS, AIFF, CAF, WMA, APE, WavPack, AC-3, AMR, and MKA.
- Added native-first FLAC playback with automatic temporary M4A fallback when WebKit cannot decode the source.
- Added eager `ffmpeg` compatibility conversion for WMA, APE, WavPack, standalone ALAC, AC-3, and AMR audio.
- Added an optional post-remux cleanup flow that saves a playable MKV remux beside the source and moves the original to the Trash.

### Music Visualization

- Added selectable spectrum bars, waveform, and combined visualization modes with persistent preference.
- Added a persistent `Colors` control that slowly cycles spectrum BAR colors through warm and cool hues, or keeps them fixed green when disabled.
- Added 72 logarithmic centre frequencies with linear interpolation over a 32768-point floating-decibel FFT across 10 Hz to 20 kHz when permitted by the source sample rate.
- Bounded waveform rendering to 1,600 points for responsive playback.
- Preserved music time, play/pause, volume, and mute state while browsing images and documents; selecting a video pauses retained audio.
- Added automatic next-track playback that skips non-audio entries and wraps through the current library order.
- Added a low-latency output gain stage so native mute changes silence playback immediately.

### Document Themes

- Set `GitHub Light` as the default document theme while preserving the user's locally saved theme selection.

### Security and Reliability

- Rejects localhost, private, link-local, multicast, CGNAT, and reserved destinations before requests, after redirects, and during connection-time DNS resolution.
- Enforces download size limits, atomic non-overwriting completion, cancellation cleanup, and local queue persistence.
- Uses no browser cookies, login state, or custom credentials and does not bypass DRM, paywalls, encrypted HLS, live HLS, or anti-bot verification.

## Requirements

- Apple Silicon Mac
- macOS 12 or later
- `ffmpeg` is optional and required only for MKV and non-native audio compatibility playback: `brew install ffmpeg`

## Install

1. Download `FastFileViewer-1.26.0824-arm64.dmg`.
2. Open the DMG and drag FastFileViewer to Applications.
