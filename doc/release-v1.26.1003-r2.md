# FastFileViewer v1.26.1003-r2

This revision reduces repeated work and temporary memory allocations across the app while preserving the existing interface, controls, features, and authentication behavior.

## Improvements

- Archive trees reuse existing directory paths, and scans reuse normalized file extensions.
- UTF-16 decoding avoids complete intermediate code-unit and rune arrays; line-ending normalization uses one output allocation.
- HLS downloads reuse one 256 KiB copy buffer across segments and select the highest-bandwidth variant in one pass.
- Audio visualization precomputes spectrum positions and reuses per-player arrays while producing the same spectrum, waveform, and combined drawings.
- Subtitle matching keeps the existing priorities without sorting all matching candidates.
- Selection updates avoid indexing the entire visible library, and unchanged code previews reuse their highlighting results.

In controlled function benchmarks, building an archive tree from 5,000 prepared entries reduced allocation count from 60,052 to 59. Copying 256 HLS segments reduced cumulative allocations from approximately 64 MiB to 268 KiB. These measurements exclude archive I/O and network download time and are not whole-app speed or resident-memory guarantees. See the [function review](https://github.com/VaderChen/FastFileViewer/blob/v1.26.1003-r2/doc/function-optimization.md) and [performance notes](https://github.com/VaderChen/FastFileViewer/blob/v1.26.1003-r2/doc/performance.md) for methods, tradeoffs, and reproducible benchmarks.

## Validation

- 146 frontend tests, 186 Go tests, and two fuzz seed suites passed.
- Go race checks, additional text-compatibility fuzzing, TypeScript/Vite production build, Go vet, and native compilation passed.
- App and player JSX structures match the previous version; all three audio visualization modes produce the same tested Canvas commands.
- Minimum macOS compatibility remains 12.0 on Apple Silicon.

## Download and compatibility

- **Apple Silicon (arm64), macOS 12 or later.**
- Download **FastFileViewer-1.26.1003-r2-arm64.dmg**, open it, and drag FastFileViewer into Applications.
- The App and DMG are signed with Developer ID, notarized by Apple, and include stapled notarization tickets.
- App version remains **1.26.1003**, with a new build number and source tag **v1.26.1003-r2** recorded in its build metadata.
- LGPL FFmpeg 8.1.2, Opus 1.6.1, and libvpx 1.16.0 remain bundled; no separate FFmpeg installation is required.
- SHA-256 checksum files accompany the DMG and matching **FastFileViewer-1.26.1003-r2-codec-sources.tar.gz** archive.

## License

FastFileViewer uses the [Source-Available, No-Commercial-Sales License 1.1](https://github.com/VaderChen/FastFileViewer/blob/v1.26.1003-r2/LICENSE.en.md). Third-party components remain under their own license terms. Complete license texts are included in the App and DMG.
