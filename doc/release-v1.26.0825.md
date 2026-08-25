FastFileViewer 1.26.0825 improves media preparation, separates long-running services, and refreshes the macOS release workflow.

## Highlights

### Media Playback

- Added an optional post-remux cleanup flow for MKV, AVI, and M2TS compatibility playback: save the playable remux beside the source and move the original to the Trash, or keep the original and continue using the temporary playback cache.
- Improved codec-aware remux planning, including compatible stream copying and WebM output for VP9 when appropriate.
- Improved concurrent media preparation, cancellation, temporary-cache release, and rollback behavior when replacing an original file cannot complete safely.

### Architecture and Reliability

- Split Wails bindings into independent library, media, and download services with shared entry and cancellable-operation registries.
- Extracted image viewing, workspace, download queue, thumbnail, formatting, and operation logic into reusable frontend modules.
- Added focused backend and frontend coverage for remux planning, media cancellation, workspace behavior, image layout, downloads, and tree updates.

### Build and Distribution

- Moved the default App output to `dist/FastFileViewer.app`.
- Added Developer ID DMG signing with automatic notary-profile discovery, App and DMG notarization, ticket stapling, Gatekeeper verification, and SHA-256 output.
- Added an existing-App packaging mode for local build-labelled DMGs while keeping clean tagged rebuilds as the formal release path.
- Updated Traditional Chinese, English, and Japanese documentation for the current features and packaging workflow.

## Requirements

- Apple Silicon Mac
- macOS 12 or later
- `ffmpeg` is optional and required for MKV, AVI, M2TS, and non-native audio compatibility playback: `brew install ffmpeg`

## Downloads

- `FastFileViewer-1.26.0825-arm64.dmg`
- `FastFileViewer-1.26.0825-arm64.dmg.sha256`


## Source and License

- Source: https://github.com/VaderChen/FastFileViewer/tree/v1.26.0825
- License: GNU GPL v3, with a separate commercial license available
- Security policy: https://github.com/VaderChen/FastFileViewer/blob/v1.26.0825/SECURITY.md
- Third-party notices: https://github.com/VaderChen/FastFileViewer/blob/v1.26.0825/THIRD-PARTY-NOTICES.md
