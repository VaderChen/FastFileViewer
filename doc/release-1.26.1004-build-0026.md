This release fixes clipped file information at the bottom of the viewer, including image EXIF, video/audio details, and the SHA-256 controls.

## Fixes

- Let the information area grow with its content so extended metadata is no longer cut off below the preview.
- Wrap the existing fields in narrow panes, including when the library sidebar is wide.
- Keep loading and extended metadata on separate rows, with the checksum control alongside the basic fields when space permits.

## Validation

- 40 native WebKit layout cases covered image/media metadata, loading states, window sizes, and library widths.
- 161 frontend tests, the Go test suite with race detection, and the signed release bundle check passed.
- TypeScript/Vite production compilation, Go vet, dependency verification, and the production dependency audit passed.

## Download

- **Apple Silicon (arm64), macOS 12 or later.**
- In versions with automatic updates, choose **Check for Updates** in About and confirm the update. Download and installation progress remain visible through the automatic restart.
- For manual installation, download **FastFileViewer-1.26.1004-build-0026-arm64.dmg**, open it, and drag FastFileViewer into Applications.
- The App and DMG are signed with Developer ID, notarized by Apple, and include stapled notarization tickets.
- LGPL FFmpeg **8.1.2**, Opus **1.6.1**, and libvpx **1.16.0** remain bundled.
- SHA-256 checksum files accompany the DMG and **FastFileViewer-1.26.1004-build-0026-codec-sources.tar.gz**, which contains matching codec sources and rebuild instructions.

## License

FastFileViewer uses the [Source-Available, No-Commercial-Sales License 1.1](https://github.com/VaderChen/FastFileViewer/blob/1.26.1004-build-0026/LICENSE.en.md). Third-party components retain their own terms; complete license texts are included in the App and DMG.
