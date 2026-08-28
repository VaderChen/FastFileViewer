<div align="center">
  <img src="assets/appicon.png" alt="FastFileViewer アイコン" width="128" />
  <h1>FastFileViewer</h1>
  <p>Go、Wails、React、TypeScript で構築された macOS 用ローカルファースト・ファイルワークスペースです。</p>
</div>

<p align="center">
  <a href="README.md">繁體中文</a> |
  <a href="README.en.md">English</a> |
  <a href="README.ja.md">日本語</a>
</p>

## 機能

- ローカルフォルダを段階的にスキャンし、画像、文書、ソースコード、メディア、字幕を統一ツリーで表示します。
- ZIP、TAR、TGZ、TAR.GZ 内の対応コンテンツを展開せずに閲覧できます。
- 一般的な画像、テキスト、Markdown、構造化データ、設定、ソースコード形式を表示します。
- Markdown 表示、構文強調、JSON ツリー、検索・並べ替え可能な CSV／TSV 表に対応します。
- 一般的な動画・音楽形式を再生し、スペクトラム、波形、または両方を選択して表示できます。選択内容はローカルに保存されます。
- `Colors` コントロールをオンにすると、BAR の色がオレンジ、黄色、緑、シアン、青、青紫の間でゆっくり変化します。オフでは固定の緑色です。
- ほかの画像や文書を閲覧しても再生位置、再生／一時停止、音量、ミュート状態を維持し、動画を選択した場合はバックグラウンド音楽を一時停止します。
- 音楽の再生終了後は音声以外の項目をスキップし、現在のライブラリ順で次の曲へ自動的に進んで循環再生します。
- スペクトラムは 32768-point floating-decibel FFT の対数中心周波数を補間し、sample rate が許す場合は 10 Hz–20 kHz を表示します。
- MP2／MP3、M4A／M4B／ALAC、WAV、AAC、FLAC、OGG／OPUS、AIFF、CAF、WMA、APE、WavPack、AC-3、AMR、MKA に対応します。
- FLAC は WebKit のネイティブ再生を優先し、失敗した場合は一時的な互換 M4A に自動変換します。
- リリース版には LGPL FFmpeg を内蔵し、MKV を一時 MP4 に自動リマックスまたはトランスコードして再生します。開発モードでは Bundle がない場合にローカルの `ffmpeg` を使用します。
- MKV のリマックス後は、再生可能なファイルを元のフォルダに保存し、元ファイルをゴミ箱へ移動するか選択できます。次回から変換は不要です。
- 同じフォルダにある VTT、SRT、ASS、SSA、SMI、テキスト形式 SUB 字幕を自動的に関連付けます。
- 「ダウンロード」に公開 HTTP/HTTPS URL を貼り付けるかドロップして、画像、動画、記事、一般ファイルを取得できます。直接アクセス可能な動画ページでは HTML とインラインスクリプトから `.m3u8` を解析します。
- `.m3u8` が 1 件なら自動開始し、複数見つかった場合は複数選択ダイアログを表示して選択ごとにダウンロードを作成します。
- 暗号化されていない完了済み `.m3u8` VOD に対応し、マスタープレイリストでは最高帯域幅のバリアントを選択して結合します。
- 画像、文書、メディア／字幕のスキャン形式を個別に設定できます。
- 3 ペインワークスペース、ピン留めフォルダ、分割読み込み、キャンセル可能な処理を提供します。
- 複数項目の書き出し、SHA-256 計算、完全重複ファイル検出に対応します。
- ライブラリインデックスとサムネイルはローカルに保存され、ネットワークサービスを使用しません。
- 繁体字中国語、英語、日本語の UI を提供します。

## オープンソース版

公開ソース版は StoreKit と App Sandbox を使用せず、ローカルのリリース認証情報や端末固有の設定を含みません。現在のユーザーアカウントがアクセスできるファイルを利用できますが、macOS の保護対象フォルダでは追加の許可が必要になる場合があります。

## 開発とビルド

必要環境は Apple Silicon Mac、macOS 12 以降、Go 1.26.4、Node.js、npm、Xcode Command Line Tools、`rsync`、`pkg-config`、libopus、libvpx です。内蔵 LGPL FFmpeg のビルドには `brew install pkg-config opus libvpx` を使用できます。

```bash
git clone https://github.com/VaderChen/FastFileViewer.git
cd FastFileViewer
./run.sh
```

```bash
./scripts/build-ffmpeg-macos.sh
./build.sh
```

出力は `dist/FastFileViewer.app` です。ビルド時に GPLv3、第三者ライセンス全文、通知、Git のビルドメタデータを App Bundle の `Contents/Resources` に含めます。

ビルド済みファイルは [GitHub Releases](https://github.com/VaderChen/FastFileViewer/releases) から取得できます。

DMG の公開ツールと署名資格情報は本 Repository に含めず、非公開のリリース環境で実行してください。

## プライバシーとセキュリティ

スキャン、Render、サムネイル、再生、内容解析はローカルで行われます。「ダウンロード」に URL を明示的に貼り付けるかドロップした場合のみ、公開 HTTP/HTTPS 宛ての外向き通信を行います。ブラウザ Cookie、ログイン状態、独自認証は使用せず、DRM、ペイウォール、暗号化 HLS、ライブ HLS には対応しません。ページ解析は JavaScript を実行せず、最大 32 MB の HTML とインラインスクリプトから最大 16 件の `.m3u8` を抽出します。内蔵ストリームには source page 由来で query を除いた Referer／Origin だけを送ります。ブラウザ Cookie、ログイン、bot verification が必要なサイトの保護は回避せず、直接 `.m3u8` URL が必要です。localhost、プライベート IP、link-local などの非公開アドレスは各リクエストとリダイレクトで拒否します。単一ファイルは 4 GB に制限され、`~/Downloads/FastFileViewer` に保存されます。

表示したコードや Markdown の生 HTML は実行されず、Markdown のリモートリソースも読み込みません。`.env*`、ローカルのリリース資産、パッケージ、個人ファイルをコミットしないでください。詳細は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

Copyright (C) 2026 VaderChen.

本プロジェクトはデュアルライセンスです。

1. オープンソース利用は [GNU General Public License v3.0](LICENSE) に従います。
2. GPLv3 に準拠できない場合や別の商用条件が必要な場合は、[商用ライセンス](COMMERCIAL-LICENSE.md) を利用できます。

第三者コンポーネントには各ライセンスが適用されます。[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を参照してください。Contributor License Agreement の整備までは Issue と設計議論のみを受け付け、外部コードの Pull Request はマージしません。
