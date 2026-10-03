This release adds in-app GitHub updates with download and installation progress, expands file information and camera RAW support, and reduces repeated work in scanning, HLS parsing, table sorting, and status polling.

## Updates

- Check for newer stable releases at startup, or choose **Check for Updates** in About.
- Confirm the update to download it, close the app, install the new version, and restart automatically. Progress remains visible in an independent installation window.
- Validate package size, SHA-256, publisher identity, release metadata, and macOS compatibility. Keep the previous app until the new interface starts, with recovery on installation or restart failure.
- Use the display version **1.26.1003 build 2237** and source tag **1.26.1003-build-2237**.

## File information and formats

- Show image dimensions, colour model, and available EXIF fields, plus video/audio duration, bitrate, codecs, dimensions, frame rate, sample rate, and channels.
- Add common camera RAW formats. Preview support depends on the camera formats supported by the installed macOS version.
- Separate programming-language formats from document formats in Settings while retaining existing saved selections.
- Include category icons for associated files; local builds can select classic, monochrome, or vivid styles.

## Performance

- Skip full-path allocations for unsupported files during directory scans.
- Parse in-memory HLS playlists without a Scanner buffer or copied line strings, preserving existing limits and parsing behavior.
- Precompute table-sort keys and skip sorting for already ordered numeric columns.
- Reuse unchanged download/update state and transfer compact progress snapshots without repeating release notes.

Controlled function benchmarks measured a 4,999-row numeric table sort at **4.535 ms → 0.724 ms**, allocations for a 2,000-file unsupported-directory scan at **690 KB → 274 KB**, and allocations for a 64-segment HLS playlist at **96.7 KB → 28.5 KB**. These are representative function measurements, not whole-app speed or resident-memory guarantees. See the [function review](https://github.com/VaderChen/FastFileViewer/blob/1.26.1003-build-2237/doc/function-optimization-followup.md) and [performance notes](https://github.com/VaderChen/FastFileViewer/blob/1.26.1003-build-2237/doc/performance.md) for inputs, methods, and limits.

## Validation

- 161 frontend tests, 207 Go tests, and three fuzz seed suites passed, including race detection and verification against a signed release bundle.
- TypeScript/Vite production compilation, Go vet, dependency verification, and the production dependency audit passed.
- The packaged native application targets macOS 12 arm64; release checks verify its signature, notarization, version metadata, and bundled media tools.

## Download

- **Apple Silicon (arm64), macOS 12 or later.**
- Download **FastFileViewer-1.26.1003-build-2237-arm64.dmg**, open it, and drag FastFileViewer into Applications.
- The App and DMG are signed with Developer ID, notarized by Apple, and include stapled notarization tickets.
- Earlier releases without the updater require this installation once; this version can check for subsequent updates in the app.
- LGPL FFmpeg **8.1.2**, Opus **1.6.1**, and libvpx **1.16.0** remain bundled.
- SHA-256 checksum files accompany the DMG and **FastFileViewer-1.26.1003-build-2237-codec-sources.tar.gz**, which contains matching codec sources and rebuild instructions.

## License

FastFileViewer uses the [Source-Available, No-Commercial-Sales License 1.1](https://github.com/VaderChen/FastFileViewer/blob/1.26.1003-build-2237/LICENSE.en.md). Third-party components retain their own terms; complete license texts are included in the App and DMG.
