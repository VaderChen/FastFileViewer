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

## 最新バージョン

[1.26.1004 build 0945](https://github.com/VaderChen/FastFileViewer/releases/tag/1.26.1004-build-0945) では、GLB／glTF、OBJ、STL、PLY、FBX、3MF の操作可能な 3D プレビューを追加し、読み込み時のバッファーメモリー、マテリアルの重複検査、描画バッファーの再確保を削減しました。更新ヘルパーの起動と ExFAT 上の開発用署名も修正し、「情報」画面を整理しました。Apple Silicon、macOS 12 以降に対応します。旧版の更新が約 65% で失敗する場合は、本版の DMG から一度手動で更新してください。

[変更履歴](CHANGELOG.md)、[リリースノート](doc/release-1.26.1004-build-0945.md)、[関数単位の検証報告](doc/function-optimization-followup.md)、[ベンチマークと測定範囲](doc/performance.md)をご覧ください。

## 機能

- 「メディア・字幕」の前に「3D ファイル」設定タブを追加。GLB、glTF、OBJ、STL、PLY、FBX、3MF をフォルダーや ZIP／TAR／TGZ／TAR.GZ から読み込み、描画できます。
- 左ドラッグで回転、右または Shift＋左ドラッグで移動、ホイールでズーム。「視点をリセット」でモデル全体を表示します。OBJ の MTL に対応し、glTF／OBJ のテクスチャとバッファーはモデルと同じフォルダーかその配下から読み込みます。
- 3D は静的プレビューです。glTF 2.0 の通常データと Meshopt に対応し、Draco／KTX2、アニメーション再生、STEP／IGES、Blender プロジェクトには未対応です。モデルと関連ファイルはそれぞれ 128 MiB までで、複雑なモデルにはジオメトリとテクスチャの上限もあります。
- 3D 形式のパーサーは必要なときだけ読み込みます。静的シーンの行列更新や同じサイズの描画バッファー再確保を省き、切り替え・キャンセル時にプレビュー資源を解放します。
- ローカルフォルダを段階的にスキャンし、画像、文書、ソースコード、メディア、字幕を統一ツリーで表示します。
- ZIP、TAR、TGZ、TAR.GZ 内の対応コンテンツを展開せずに閲覧できます。
- 一般的な画像、テキスト、Markdown、構造化データ、設定、ソースコード形式を表示します。
- 各社の一般的なカメラ RAW（DNG、CRW／CR2／CR3、NEF／NRW、ARW／SRF／SR2、RAF、ORF、RW2、PEF、SRW、ERF、MRW、GPR、R3D、FFF、3FR、IIQ、X3F）を、macOS が対応する機種では ImageIO でプレビューできます。
- Finder の関連付けファイルには App アイコンとは異なるカテゴリ別アイコンを使用し、文書、画像、メディア／字幕、アーカイブを分けて表示します。ビルド時に `FASTFILEVIEWER_FILE_ICON_STYLE=classic|monochrome|vivid ./build.command` で既定スタイルを選択できます。
- Markdown 表示、構文強調、JSON ツリー、検索・並べ替え可能な CSV／TSV 表に対応します。
- 文書テーマの既定値は `GitHub Light` です。ほかのテーマにも切り替えられ、選択内容はローカルに保存されます。
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
- 画像、文書、プログラミング言語、3D ファイル、メディア／字幕のスキャン形式を個別に設定できます。
- 3 ペインワークスペース、ピン留めフォルダ、分割読み込み、キャンセル可能な処理を提供します。
- 複数項目の書き出し、SHA-256 計算、完全重複ファイル検出に対応します。
- ライブラリインデックスとサムネイルはローカルに保存され、ネットワークサービスを使用しません。
- 繁体字中国語、英語、日本語の UI を提供します。

## ソース公開版

公開ソース版は StoreKit と App Sandbox を使用せず、ローカルのリリース認証情報や端末固有の設定を含みません。現在のユーザーアカウントがアクセスできるファイルを利用できますが、macOS の保護対象フォルダでは追加の許可が必要になる場合があります。

## 開発とビルド

- CMake と `pkg-config`（内蔵コーデックのビルドに必要です。`brew install cmake pkg-config` でインストールできます）

```bash
git clone https://github.com/VaderChen/FastFileViewer.git
cd FastFileViewer
./run.sh
```

開発とビルドでは、`go.mod` で指定した Wails CLI を `build/tools` に用意します。App のパッケージ作成後、署名の直前に Bundle 内の AppleDouble メタデータを削除し、ExFAT 上の `._` ファイルによる署名エラーを防ぎます。

```bash
./scripts/build-codec-deps-macos.sh
./scripts/build-ffmpeg-macos.sh
./build.sh
```

コーデックは macOS 12 を対象にソースからビルドし、`third_party/codecs` と `third_party/ffmpeg` に保存します。より新しい macOS を要求するライブラリはパッケージ作成時に拒否します。

出力は `dist/FastFileViewer.app` です。ビルド時にプロジェクトのライセンス、第三者ライセンス全文、通知、Git のビルドメタデータを App Bundle の `Contents/Resources` に含めます。

ビルド済みファイルは [GitHub Releases](https://github.com/VaderChen/FastFileViewer/releases) から取得できます。

起動時に GitHub の新しい正式リリースを自動確認します。「設定 → 情報 → アップデートを確認」から手動確認もできます。新しいバージョンと変更内容を確認して「更新して再起動」を押すと、進捗を表示しながらダウンロードし、終了・インストール・再起動を自動で行います。ダウンロードと準備中はキャンセルできます。アプリ終了後は独立した更新ウィンドウが進捗を表示します。新版の画面が起動するまで旧版を保存し、失敗時は復元を試みます。正式に署名された Apple Silicon アプリと書き込み可能なインストール先が必要です。DMG から直接実行せず、先に「アプリケーション」へコピーしてください。

DMG の公開ツールと署名資格情報は本 Repository に含めず、非公開のリリース環境で実行してください。

## プライバシーとセキュリティ

起動時と手動の更新確認時に GitHub の正式リリース情報を取得し、確認後にインストーラーをダウンロードします。ローカルファイル、フォルダのパス、アカウント認証情報は送信しません。

スキャン、Render、サムネイル、再生、内容解析はローカルで行われます。「ダウンロード」に URL を明示的に貼り付けるかドロップすると、公開 HTTP/HTTPS 宛ての外向き通信を行います。ブラウザ Cookie、ログイン状態、独自認証は使用せず、DRM、ペイウォール、暗号化 HLS、ライブ HLS には対応しません。ページ解析は JavaScript を実行せず、最大 32 MB の HTML とインラインスクリプトから最大 16 件の `.m3u8` を抽出します。内蔵ストリームには source page 由来で query を除いた Referer／Origin だけを送ります。ブラウザ Cookie、ログイン、bot verification が必要なサイトの保護は回避せず、直接 `.m3u8` URL が必要です。localhost、プライベート IP、link-local などの非公開アドレスは各リクエストとリダイレクトで拒否します。単一ファイルは 4 GB に制限され、`~/Downloads/FastFileViewer` に保存されます。

表示したコードや Markdown の生 HTML は実行されず、Markdown のリモートリソースも読み込みません。`.env*`、ローカルのリリース資産、パッケージ、個人ファイルをコミットしないでください。詳細は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

Copyright (C) 2026 VaderChen.

本プロジェクトは[ソース公開・商業販売禁止ライセンス 1.1](LICENSE.ja.md)を採用しています。条項を遵守する非販売の利用、変更、無料共有（組織内部での利用を含む）を許可します。詳細はライセンス全文を参照してください。別途の許諾に関する問い合わせは[ライセンス方針](COMMERCIAL-LICENSE.md)をご覧ください。

商業販売の制限を含む独自のソース公開ライセンスです。第三者コンポーネントには各ライセンスが適用されます。[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を参照してください。Contributor License Agreement の整備までは Issue と設計議論のみを受け付け、外部コードの Pull Request はマージしません。
