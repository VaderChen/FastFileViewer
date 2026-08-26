# Third-Party Notices

This project includes third-party software. Each dependency remains subject to its own license terms.
The complete, deduplicated license and notice texts are provided in `THIRD-PARTY-LICENSES.txt`.

Covered build targets: `darwin/arm64`.

## Optional bundled FFmpeg

Release builds bundle an LGPL shared-library build of FFmpeg 8.1.2 made by `scripts/build-ffmpeg-macos.sh`. It enables VideoToolbox, AudioToolbox, libopus, and libvpx, and does not enable GPL, nonfree, libx264, libx265, or libxvid components. Source is available from `https://ffmpeg.org/releases/`; the complete configure command is recorded in the build script.

## Go Dependencies

| Package | Version | Declared license | Documents | Targets |
| --- | --- | --- | --- | --- |
| github.com/leaanthony/go-ansi-parser | v1.6.1 | See bundled license text | L035 | `darwin/arm64` |
| github.com/leaanthony/slicer | v1.6.0 | See bundled license text | L019 | `darwin/arm64` |
| github.com/leaanthony/u | v1.1.1 | See bundled license text | L040 | `darwin/arm64` |
| github.com/pkg/errors | v0.9.1 | See bundled license text | L024 | `darwin/arm64` |
| github.com/rivo/uniseg | v0.4.7 | See bundled license text | L027 | `darwin/arm64` |
| github.com/wailsapp/wails/v2 | v2.13.0 | See bundled license text | L034 | `darwin/arm64` |
| golang.org/x/image | v0.44.0 | See bundled license text | L025 | `darwin/arm64` |
| golang.org/x/text | v0.40.0 | See bundled license text | L025 | `darwin/arm64` |

## npm Dependencies

| Package | Version | Declared license | Documents | Targets |
| --- | --- | --- | --- | --- |
| @fortawesome/fontawesome-common-types | 7.3.0 | MIT | L004 | `darwin/arm64` |
| @fortawesome/fontawesome-svg-core | 7.3.0 | MIT | L004 | `darwin/arm64` |
| @fortawesome/free-solid-svg-icons | 7.3.0 | (CC-BY-4.0 AND MIT) | L004 | `darwin/arm64` |
| @fortawesome/react-fontawesome | 3.3.1 | MIT | L028 | `darwin/arm64` |
| @types/debug | 4.1.13 | MIT | L031 | `darwin/arm64` |
| @types/estree | 1.0.9 | MIT | L031 | `darwin/arm64` |
| @types/estree-jsx | 1.0.5 | MIT | L031 | `darwin/arm64` |
| @types/hast | 3.0.5 | MIT | L031 | `darwin/arm64` |
| @types/mdast | 4.0.4 | MIT | L031 | `darwin/arm64` |
| @types/ms | 2.1.0 | MIT | L031 | `darwin/arm64` |
| @types/prop-types | 15.7.15 | MIT | L031 | `darwin/arm64` |
| @types/react | 18.3.31 | MIT | L031 | `darwin/arm64` |
| @types/unist | 2.0.11 | MIT | L031 | `darwin/arm64` |
| @types/unist | 3.0.3 | MIT | L031 | `darwin/arm64` |
| @ungap/structured-clone | 1.3.2 | ISC | L036 | `darwin/arm64` |
| bail | 2.0.2 | MIT | L015 | `darwin/arm64` |
| ccount | 2.0.1 | MIT | L015 | `darwin/arm64` |
| character-entities | 2.0.2 | MIT | L015 | `darwin/arm64` |
| character-entities-html4 | 2.1.0 | MIT | L015 | `darwin/arm64` |
| character-entities-legacy | 3.0.0 | MIT | L015 | `darwin/arm64` |
| character-reference-invalid | 2.0.1 | MIT | L015 | `darwin/arm64` |
| comma-separated-tokens | 2.0.3 | MIT | L033 | `darwin/arm64` |
| csstype | 3.2.3 | MIT | L002 | `darwin/arm64` |
| debug | 4.4.3 | MIT | L006 | `darwin/arm64` |
| decode-named-character-reference | 1.3.0 | MIT | L037 | `darwin/arm64` |
| dequal | 2.0.3 | MIT | L007 | `darwin/arm64` |
| devlop | 1.1.0 | MIT | L020 | `darwin/arm64` |
| escape-string-regexp | 5.0.0 | MIT | L013 | `darwin/arm64` |
| estree-util-is-identifier-name | 3.0.0 | MIT | L012 | `darwin/arm64` |
| extend | 3.0.2 | MIT | L032 | `darwin/arm64` |
| github-markdown-css | 5.9.0 | MIT | L013 | `darwin/arm64` |
| hast-util-is-element | 3.0.0 | MIT | L033 | `darwin/arm64` |
| hast-util-to-jsx-runtime | 2.3.6 | MIT | L037 | `darwin/arm64` |
| hast-util-to-text | 4.0.2 | MIT | L016 | `darwin/arm64` |
| hast-util-whitespace | 3.0.0 | MIT | L033 | `darwin/arm64` |
| highlight.js | 11.11.1 | BSD-3-Clause | L018 | `darwin/arm64` |
| html-url-attributes | 3.0.1 | MIT | L038 | `darwin/arm64` |
| inline-style-parser | 0.2.7 | MIT | L008 | `darwin/arm64` |
| is-alphabetical | 2.0.1 | MIT | L033 | `darwin/arm64` |
| is-alphanumerical | 2.0.1 | MIT | L033 | `darwin/arm64` |
| is-decimal | 2.0.1 | MIT | L033 | `darwin/arm64` |
| is-hexadecimal | 2.0.1 | MIT | L033 | `darwin/arm64` |
| is-plain-obj | 4.1.0 | MIT | L013 | `darwin/arm64` |
| js-tokens | 4.0.0 | MIT | L005 | `darwin/arm64` |
| longest-streak | 3.1.0 | MIT | L026 | `darwin/arm64` |
| loose-envify | 1.4.0 | MIT | L010 | `darwin/arm64` |
| lowlight | 3.3.0 | MIT | L037 | `darwin/arm64` |
| markdown-table | 3.0.4 | MIT | L037 | `darwin/arm64` |
| mdast-util-find-and-replace | 3.0.2 | MIT | L037 | `darwin/arm64` |
| mdast-util-from-markdown | 2.0.3 | MIT | L037 | `darwin/arm64` |
| mdast-util-gfm | 3.1.0 | MIT | L037 | `darwin/arm64` |
| mdast-util-gfm-autolink-literal | 2.0.1 | MIT | L012 | `darwin/arm64` |
| mdast-util-gfm-footnote | 2.1.0 | MIT | L037 | `darwin/arm64` |
| mdast-util-gfm-strikethrough | 2.0.0 | MIT | L012 | `darwin/arm64` |
| mdast-util-gfm-table | 2.0.0 | MIT | L012 | `darwin/arm64` |
| mdast-util-gfm-task-list-item | 2.0.0 | MIT | L012 | `darwin/arm64` |
| mdast-util-mdx-expression | 2.0.1 | MIT | L012 | `darwin/arm64` |
| mdast-util-mdx-jsx | 3.2.0 | MIT | L012 | `darwin/arm64` |
| mdast-util-mdxjs-esm | 2.0.1 | MIT | L012 | `darwin/arm64` |
| mdast-util-phrasing | 4.1.0 | MIT | L029 | `darwin/arm64` |
| mdast-util-to-hast | 13.2.1 | MIT | L033 | `darwin/arm64` |
| mdast-util-to-markdown | 2.1.2 | MIT | L037 | `darwin/arm64` |
| mdast-util-to-string | 4.0.0 | MIT | L015 | `darwin/arm64` |
| micromark | 4.0.2 | MIT | L037 | `darwin/arm64` |
| micromark-core-commonmark | 2.0.3 | MIT | L037 | `darwin/arm64` |
| micromark-extension-gfm | 3.0.0 | MIT | L012 | `darwin/arm64` |
| micromark-extension-gfm-autolink-literal | 2.1.0 | MIT | L012 | `darwin/arm64` |
| micromark-extension-gfm-footnote | 2.1.0 | MIT | L021 | `darwin/arm64` |
| micromark-extension-gfm-strikethrough | 2.1.0 | MIT | L012 | `darwin/arm64` |
| micromark-extension-gfm-table | 2.1.1 | MIT | L037 | `darwin/arm64` |
| micromark-extension-gfm-tagfilter | 2.0.0 | MIT | L012 | `darwin/arm64` |
| micromark-extension-gfm-task-list-item | 2.1.0 | MIT | L012 | `darwin/arm64` |
| micromark-factory-destination | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-factory-label | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-factory-space | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-factory-title | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-factory-whitespace | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-character | 2.1.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-chunked | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-classify-character | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-combine-extensions | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-decode-numeric-character-reference | 2.0.2 | MIT | L037 | `darwin/arm64` |
| micromark-util-decode-string | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-encode | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-html-tag-name | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-normalize-identifier | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-resolve-all | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-sanitize-uri | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-subtokenize | 2.1.0 | MIT | L037 | `darwin/arm64` |
| micromark-util-symbol | 2.0.1 | MIT | L037 | `darwin/arm64` |
| micromark-util-types | 2.0.2 | MIT | L037 | `darwin/arm64` |
| ms | 2.1.3 | MIT | L003 | `darwin/arm64` |
| parse-entities | 4.0.2 | MIT | L014 | `darwin/arm64` |
| property-information | 7.2.0 | MIT | L014 | `darwin/arm64` |
| react | 18.3.1 | MIT | L011 | `darwin/arm64` |
| react-dom | 18.3.1 | MIT | L011 | `darwin/arm64` |
| react-markdown | 10.1.0 | MIT | L039 | `darwin/arm64` |
| rehype-highlight | 7.0.2 | MIT | L037 | `darwin/arm64` |
| remark-gfm | 4.0.1 | MIT | L037 | `darwin/arm64` |
| remark-parse | 11.0.0 | MIT | L009 | `darwin/arm64` |
| remark-rehype | 11.1.2 | MIT | L037 | `darwin/arm64` |
| remark-stringify | 11.0.0 | MIT | L009 | `darwin/arm64` |
| scheduler | 0.23.2 | MIT | L011 | `darwin/arm64` |
| space-separated-tokens | 2.0.2 | MIT | L033 | `darwin/arm64` |
| stringify-entities | 4.0.4 | MIT | L026 | `darwin/arm64` |
| style-to-js | 1.1.21 | MIT | L030 | `darwin/arm64` |
| style-to-object | 1.0.14 | MIT | L023 | `darwin/arm64` |
| trim-lines | 3.0.1 | MIT | L026 | `darwin/arm64` |
| trough | 2.2.0 | MIT | L017 | `darwin/arm64` |
| unified | 11.0.5 | MIT | L001 | `darwin/arm64` |
| unist-util-find-after | 5.0.0 | MIT | L015 | `darwin/arm64` |
| unist-util-is | 6.0.1 | MIT | L022 | `darwin/arm64` |
| unist-util-position | 5.0.0 | MIT | L015 | `darwin/arm64` |
| unist-util-stringify-position | 4.0.0 | MIT | L033 | `darwin/arm64` |
| unist-util-visit | 5.1.0 | MIT | L015 | `darwin/arm64` |
| unist-util-visit-parents | 6.0.2 | MIT | L033 | `darwin/arm64` |
| vfile | 6.0.3 | MIT | L001 | `darwin/arm64` |
| vfile-message | 4.0.3 | MIT | L037 | `darwin/arm64` |
| zwitch | 2.0.4 | MIT | L033 | `darwin/arm64` |
