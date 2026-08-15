<div align="center">
  <img src="assets/appicon.png" alt="FastFileViewer アイコン" width="128" />
  <h1>FastFileViewer</h1>
  <p>Go、Wails、React、TypeScript で構築された macOS 用オフラインコンテンツワークスペースです。</p>
</div>

<p align="center">
  <a href="README.md">繁體中文</a> |
  <a href="README.en.md">English</a> |
  <a href="README.ja.md">日本語</a>
</p>

## 機能

- ローカルフォルダを段階的にスキャンし、画像、文書、ソースコードを統一ツリーで表示します。
- ZIP、TAR、TGZ、TAR.GZ 内の対応コンテンツを展開せずに閲覧できます。
- 一般的な画像、テキスト、Markdown、構造化データ、設定、ソースコード形式を表示します。
- Markdown 表示、構文強調、JSON ツリー、検索・並べ替え可能な CSV／TSV 表に対応します。
- 3 ペインワークスペース、ピン留めフォルダ、分割読み込み、キャンセル可能な処理を提供します。
- 複数項目の書き出し、SHA-256 計算、完全重複ファイル検出に対応します。
- ライブラリインデックスとサムネイルはローカルに保存され、ネットワークサービスを使用しません。
- 繁体字中国語、英語、日本語の UI を提供します。

## オープンソース版

公開ソース版は StoreKit と App Sandbox を使用せず、Apple 証明書、Provisioning Profile、秘密鍵、App Store パッケージ、公証処理を含みません。現在のユーザーアカウントがアクセスできるファイルを利用できますが、macOS の保護対象フォルダでは追加の許可が必要になる場合があります。

公開ビルドはデフォルトで ad-hoc 署名を使用します。Developer ID 署名、公証、DMG、正式配布は配布者が別途対応してください。

## 開発とビルド

必要環境は Apple Silicon Mac、macOS 12 以降、Go 1.26.4、Node.js、npm、Xcode Command Line Tools、`rsync` です。

```bash
git clone https://github.com/VaderChen/FastFileViewer.git
cd FastFileViewer
./run.sh
```

```bash
./build.sh
```

出力は `build/bin/FastFileViewer.app` です。ビルド時に GPLv3、第三者ライセンス全文、通知、Git のビルドメタデータを App Bundle の `Contents/Resources` に含めます。

## プライバシーとセキュリティ

すべての処理はローカルで行われます。表示したコードや Markdown の生 HTML は実行されず、Markdown のリモートリソースも読み込みません。`cert/`、`.env*`、署名資産、パッケージ、個人ファイルをコミットしないでください。詳細は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

Copyright (C) 2026 VaderChen.

本プロジェクトはデュアルライセンスです。

1. オープンソース利用は [GNU General Public License v3.0](LICENSE) に従います。
2. GPLv3 に準拠できない場合や別の商用条件が必要な場合は、[商用ライセンス](COMMERCIAL-LICENSE.md) を利用できます。

第三者コンポーネントには各ライセンスが適用されます。[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) を参照してください。Contributor License Agreement の整備までは Issue と設計議論のみを受け付け、外部コードの Pull Request はマージしません。
