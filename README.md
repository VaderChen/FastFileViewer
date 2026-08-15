<div align="center">
  <img src="assets/appicon.png" alt="FastFileViewer icon" width="128" />
  <h1>FastFileViewer</h1>
  <p>以 Go、Wails、React 與 TypeScript 建立的 macOS 離線內容工作台。</p>
</div>

<p align="center">
  <a href="README.md">繁體中文</a> |
  <a href="README.en.md">English</a> |
  <a href="README.ja.md">日本語</a>
</p>

## 功能

- 逐目錄掃描本機資料夾，建立圖片、文件與程式碼的統一內容樹。
- 不解壓縮直接瀏覽 ZIP、TAR、TGZ 與 TAR.GZ 內的支援內容。
- 預覽 PNG、JPEG、GIF、WebP、BMP、SVG、TIFF 與 HEIC。
- 顯示 TXT、Markdown、JSON、CSV、TSV、常見設定檔與多種程式語言。
- 提供 Markdown Render、程式碼語法高亮、JSON 樹及可搜尋排序的 CSV／TSV 表格。
- 三區式內容工作區、持久化釘選目錄、批次載入及可取消作業。
- 跨資料夾與壓縮檔多選匯出、SHA-256 檢查及完全重複檔案偵測。
- 目錄索引、縮圖及相鄰圖片快取均保存在本機，不需網路服務。
- 繁體中文、英文與日文介面。

## 開源版

公開原始碼版本不使用 StoreKit、不啟用 App Sandbox，也不包含 Apple 憑證、Provisioning Profile、私鑰、App Store PKG 或公證流程。應用程式可存取目前登入帳號原本就有權限的檔案與目錄；macOS 對桌面、文件、下載項目或外接磁碟等隱私保護位置仍可能要求授權。

公開建置預設使用 ad-hoc 簽章，適合自行建置與驗證。GitHub 公開版本不包含 Developer ID、Apple notarization 或 DMG 發布流程；散布者須自行負責正式簽章、公證與發布要求。

## 開發需求

- Apple Silicon Mac 與 macOS 12 或更新版本
- Go 1.26.4 或相容版本
- Node.js 與 npm
- Xcode Command Line Tools
- `rsync`

建置腳本會使用 `go.mod` 指定的 Wails v2 版本。

## 取得原始碼

```bash
git clone https://github.com/VaderChen/FastFileViewer.git
cd FastFileViewer
```

## 開發模式

```bash
./run.sh
```

`run.sh` 會在本機暫存目錄建立開發鏡像，避免外接磁碟上的 AppleDouble 檔案與大量小檔案影響 Wails。

## 建置 macOS App

```bash
./build.sh
```

輸出：

```text
build/bin/FastFileViewer.app
```

建置流程會執行 Go vet、race test、前端測試與 npm audit，並在 App Bundle 的 `Contents/Resources` 中加入：

- `Licenses/GPL-3.0.txt`
- `Licenses/THIRD-PARTY-NOTICES.md`
- `Licenses/THIRD-PARTY-LICENSES.txt`
- `build-metadata.json`

如需使用已安裝的 Developer ID Application 簽章，可自行指定：

```bash
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" ./build.sh
```

此命令只負責簽章，不會進行 Apple notarization。

## 資料與隱私

- 所有內容處理均在本機完成。
- App 不執行顯示的程式碼或 Markdown 原始 HTML。
- Markdown 不載入遠端圖片或連結資源。
- 目錄索引與縮圖位於 `os.UserCacheDir()` 下的 `FastFileViewer` 目錄。
- App 只會匯出到使用者主動選取的位置。

請勿提交 `cert/`、`.env*`、安裝包、簽章資產、個人檔案或包含真實路徑的除錯資料。安全問題請參閱 [SECURITY.md](SECURITY.md)。

## 授權

Copyright (C) 2026 VaderChen.

本專案採雙軌授權：

1. 開放原始碼使用遵循 [GNU General Public License v3.0](LICENSE)。
2. 無法遵循 GPLv3、需要閉源整合或其他商業條款者，可另行取得[商業授權](COMMERCIAL-LICENSE.md)。

商業授權僅涵蓋授權方有權另行授權的程式碼與資產；第三方套件仍適用各自條款。第三方清冊請參閱 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

正式 Contributor License Agreement 完成前，僅接受 Issue、文件回報與設計討論，詳見 [CONTRIBUTING.md](CONTRIBUTING.md)。
