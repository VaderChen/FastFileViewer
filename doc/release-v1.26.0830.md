FastFileViewer 1.26.0830 improves the startup path used when opening a file from Finder or the macOS `open` command.

## Highlights

- The requested file is validated and shown immediately instead of waiting for a complete directory scan.
- Directory indexing continues in the background and keeps the opened file selected.
- Previous library cache restoration no longer blocks a system-open request.
- Direct launch arguments and macOS file-open events now share the same handling path.

## Compatibility

- Apple Silicon Mac
- macOS 12 or later
- The application remains local-first; no network connection is required to open or preview local files.

## Download

- `FastFileViewer-1.26.0830-arm64.dmg`
