This release adds interactive 3D model previews, reduces their memory and processing overhead, and fixes automatic-update preparation and ExFAT development signing.

## 3D previews

- Open GLB/glTF, OBJ with MTL, STL, PLY meshes or point clouds, FBX, and 3MF from folders or supported archives.
- Rotate with left drag, pan with right drag or Shift + left drag, zoom with the wheel, and use Reset view to fit the model.
- Configure model formats in the new **3D Files** tab before **Media & Subtitles**. Models have their own library filter, counts, icons, and Finder associations.
- Load local textures and buffers within the model directory; missing textures show a warning while available geometry remains visible.
- Previews are static. glTF supports Meshopt; Draco/KTX2, animation playback, STEP/IGES, and native Blender projects are not supported. Each input resource is limited to 128 MiB, with separate geometry and texture budgets.

## Performance and fixes

- Load only the selected format parser, reuse shared-material inspection, avoid repeated static world-matrix updates and unchanged drawing-buffer allocations, and skip unused environment maps.
- Fill known-length inputs directly and coalesce progress updates; release scenes promptly on cancellation and close shared or late images once. Existing rendering and mouse controls are preserved.
- Synthetic checks measured input ArrayBuffers at about **128 to 68 MiB** for a 64 MiB stream and shared 5,000-mesh inspection at **4.13 to 0.82 ms**. These are isolated measurements, not total App/GPU memory or overall speedup; see the [benchmark method and limits](https://github.com/VaderChen/FastFileViewer/blob/1.26.1004-build-0945/doc/performance.md).
- Preserve the complete signed bundle when preparing the installer helper, fixing a preparation/startup failure during automatic updates.
- Right-align **Check for Updates** and remove the requested build-source, license, and notice rows from About. Complete license texts and build metadata remain bundled.
- Remove generated AppleDouble metadata immediately before Wails signing so development, hot rebuilds, and App builds work on ExFAT.

## Validation

- 176 frontend tests, the Go test suite with race detection, Go vet, dependency verification, TypeScript/Vite production compilation, and the production dependency audit passed.
- 13 before/after native WebKit comparisons produced identical pixels and verified rotation, panning, zoom, reset, idle rendering, and cancellation. Production chunks also passed HTTP and `wails://` checks.
- The signed release and installer-helper tests verify Gatekeeper acceptance and the helper's actual WebKit readiness handshake.

## Download and update

- **Apple Silicon (arm64), macOS 12 or later.**
- Use **Check for Updates** in About, or download **FastFileViewer-1.26.1004-build-0945-arm64.dmg**, open it, and drag FastFileViewer into Applications.
- **If an older version fails near 65% during updating, install this DMG manually once.** The corrected installer helper is included in this release; an already installed older updater cannot apply its own fix before installation.
- The App and DMG are Developer ID signed, notarized by Apple, and include stapled tickets.
- LGPL FFmpeg **8.1.2**, Opus **1.6.1**, and libvpx **1.16.0** remain bundled. Matching codec sources and rebuild instructions are provided in **FastFileViewer-1.26.1004-build-0945-codec-sources.tar.gz**. SHA-256 files accompany both downloads.

## License

FastFileViewer uses the [Source-Available, No-Commercial-Sales License 1.1](https://github.com/VaderChen/FastFileViewer/blob/1.26.1004-build-0945/LICENSE.en.md). Third-party components retain their own terms; complete license texts are included in the App and DMG.
