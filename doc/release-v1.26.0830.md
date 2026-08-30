FastFileViewer 1.26.0830 improves the startup path used when opening a file from Finder or the macOS `open` command.

## Highlights

- The requested file is validated and shown immediately instead of waiting for a complete directory scan.
- Directory indexing continues in the background and keeps the opened file selected.
- Previous library cache restoration no longer blocks a system-open request.
- Direct launch arguments and macOS file-open events now share the same handling path.

## Subtitle adjustments

- Automatically detects and loads a same-name sidecar subtitle when playing supported video and audio files.
- Supports SRT and WebVTT subtitle files, including basic SRT validation and safe line-break normalization.
- Added a custom subtitle settings panel for font family, display-proportional font size, text colour, background colour, background opacity, and vertical position.
- Subtitle rendering uses a custom overlay with adjustable edge highlighting and content-width background, so a 0% background opacity does not leave the player's built-in translucent box behind.

## Compatibility

- Apple Silicon Mac
- macOS 12 or later
- The application remains local-first; no network connection is required to open or preview local files.

## Download

- `FastFileViewer-1.26.0830-arm64.dmg`
