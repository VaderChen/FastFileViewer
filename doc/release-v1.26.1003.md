# FastFileViewer v1.26.1003

This release improves performance, memory allocation, and reliability while preserving the existing interface layout, controls, features, and authentication behavior.

## Improvements

- Large libraries need fewer repeated tree traversals and temporary arrays during scans, filtering, selection updates, and batch moves.
- Directory scanning preserves Finder priority and cancellation while avoiding repeated sorting of the pending queue.
- CSV/TSV filtering and natural-order sorting reuse comparison work and avoid unnecessary row copies.
- Filename sorting, duplicate detection, thumbnail encoding, and small bounded reads allocate less temporary memory.
- Thumbnail and archive caches stay bounded, and cancelled or superseded operations release resources promptly.
- Archive indexing, source-change detection, downloads, file operations, and subtitle handling include additional reliability fixes.
- Project documentation and About license text now match the existing project license.

Reproducible microbenchmarks and their measurement limits are documented in [performance.md](https://github.com/VaderChen/FastFileViewer/blob/v1.26.1003/doc/performance.md). These measurements are specific to the tested operations and do not represent whole-application memory or speed guarantees.

## Download and compatibility

- **Apple Silicon (arm64), macOS 12 or later.**
- Download **FastFileViewer-1.26.1003-arm64.dmg**, open it, and drag FastFileViewer into Applications.
- The App and DMG are signed with Developer ID, notarized by Apple, and include stapled notarization tickets.
- The App bundles LGPL FFmpeg 8.1.2, Opus 1.6.1, and libvpx 1.16.0; no separate FFmpeg installation is required.
- SHA-256 checksum files accompany the DMG and the codec source archive.
- **FastFileViewer-1.26.1003-codec-sources.tar.gz** contains the matching codec sources and build instructions.

## License

FastFileViewer uses the [Source-Available, No-Commercial-Sales License 1.1](https://github.com/VaderChen/FastFileViewer/blob/v1.26.1003/LICENSE.en.md). Third-party components remain under their own license terms. Complete license texts are included in the App and DMG.
