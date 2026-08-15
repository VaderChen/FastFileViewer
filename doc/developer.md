# FastFileViewer Developer Guide

## 專案定位

FastFileViewer 是 macOS 離線內容工作台，可瀏覽一般資料夾與 ZIP、TAR、TGZ、TAR.GZ 內的圖片、文字、Markdown、程式碼及常見設定檔。

核心能力：

- 不解壓縮直接瀏覽壓縮檔內容。
- 圖片 Viewer、Markdown Render、結構化資料與程式碼語法高亮整合於同一內容樹。
- 三區式內容工作區、格式篩選、釘選目錄、多選匯出及 SHA-256 完全重複偵測。
- 大型內容樹與縮圖使用本機磁碟快取；圖片使用容量受限 LRU 與相鄰預載。
- 完全離線，不執行程式碼、不執行 Markdown 原始 HTML。

## 開源身分

- Repository：`https://github.com/VaderChen/FastFileViewer`
- Go module：`github.com/VaderChen/FastFileViewer`
- 預設 Bundle ID：`com.vader.fastfileviewer`
- 開源授權：GPL-3.0-only
- 可選商業授權：`COMMERCIAL-LICENSE.md`
- 最低 macOS：12.0
- 架構：Apple Silicon arm64

公開版不啟用 App Sandbox，不包含 StoreKit、Apple 憑證、Provisioning Profile、Developer ID 公證、DMG 或 App Store PKG 流程。

## 技術組成

- 後端：Go 1.26.4
- 桌面框架：Wails 2.13.0
- 前端：React 18、TypeScript、Vite 8
- Markdown：`react-markdown`、`remark-gfm`
- 語法上色：`highlight.js`、`rehype-highlight`
- 圖示：Font Awesome

## 主要目錄

- `main.go`：Wails 入口與視窗設定。
- `internal/app/app.go`：掃描、壓縮檔、圖片／文件載入、快取、匯出與重複偵測。
- `internal/app/types.go`：前後端資料模型。
- `frontend/src/App.tsx`：內容樹、Viewer、工作區、設定與 About 授權資訊。
- `frontend/src/styles.css`：版面與 Viewer 樣式。
- `scripts/generate-third-party-notices.mjs`：產生第三方套件清冊與完整授權文字。
- `scripts/write-build-metadata.mjs`：產生可追溯建置資訊。
- `build/darwin/Info.plist`：macOS production bundle 模板。

## 後端 API

- `Bootstrap()`：回傳預設路徑及支援格式。
- `SelectDirectory(title)`：原生目錄選擇器。
- `BeginOperation()`／`CancelOperation(id)`／`FinishOperation(id)`：可取消作業生命週期。
- `ScanDirectory(...)`：掃描單層目錄並回傳壓縮檔警告。
- `LoadImageByPathWithOperation(...)`：支援取消的圖片讀取。
- `LoadThumbnailByPath(...)`：產生或讀取縮圖快取。
- `LoadDocumentByPath(...)`：讀取一般或壓縮檔內文件。
- `LoadLibraryCache(...)`／`SaveLibraryCache(...)`：讀寫目錄索引快取。
- `ExportImages(...)`：串流匯出選取內容。
- `DetectDuplicates(...)`／`CalculateChecksum(...)`：串流 SHA-256。
- `GetAppInfo()`：硬體、OS、版本、Git revision、來源網址及授權資訊。

## 安全限制

- 文件預覽上限 8 MB；語法 Render 最多 2,000,000 字元或 30,000 行。
- 圖片讀取上限 128 MB；縮圖來源上限 64 MB。
- 圖片解碼上限 50 megapixels。
- 匯出及 SHA-256 單一項目上限 4 GB。
- Markdown URL 全部阻擋，不載入遠端內容或原始 HTML。
- AppleDouble、`.DS_Store`、`__MACOSX` 與明顯二進位文件會被忽略或拒絕 Render。

## 開發模式

```bash
./run.sh
```

腳本會：

1. 依 `go.mod` 安裝相同版本的 Wails CLI。
2. 依 `package-lock.json` 安裝前端依賴至本機暫存目錄。
3. 建立本機開發鏡像並持續同步原始碼。
4. 從鏡像啟動 Wails dev，避免外接磁碟 AppleDouble 問題。

## 公開版建置

```bash
./build.sh
```

可覆寫參數：

```bash
APP_MARKETING_VERSION=1.26.0815 \
APP_BUILD_LABEL=1200 \
APP_BUNDLE_ID=com.example.fastfileviewer \
BUILD_SOURCE_URL=https://github.com/example/FastFileViewer \
./build.sh
```

正式簽章可指定：

```bash
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" ./build.sh
```

未指定時使用 ad-hoc 簽章。腳本不執行 notarization，也不產生 DMG、PKG 或安裝程式。

建置流程：

1. `go mod verify`、`go vet`、`go test -race`。
2. 前端測試、production build 與 production dependency audit。
3. 產生 `THIRD-PARTY-NOTICES.md` 與 `THIRD-PARTY-LICENSES.txt`。
4. 在本機暫存目錄建立 Wails App。
5. 嵌入 GPLv3、第三方授權及 `build-metadata.json`。
6. 移除 embedded provisioning profile，執行 ad-hoc 或指定身分簽章。
7. 驗證簽章並輸出 `build/bin/FastFileViewer.app`。

## 授權清冊

手動更新：

```bash
node scripts/generate-third-party-notices.mjs
```

此命令會更新已追蹤的 `THIRD-PARTY-NOTICES.md`，並產生被 Git 忽略的 `THIRD-PARTY-LICENSES.txt`。完整文字會隨 App Bundle 發布。

## GitHub 公開前檢查

1. 確認 `cert/`、`build/bin/`、`dist/`、`frontend/dist/` 未加入 Git。
2. 搜尋私鑰、Token、Team ID、Provisioning Profile、個人絕對路徑與安裝包。
3. 執行完整 `./build.sh`。
4. 驗證 App 內含 `Contents/Resources/Licenses` 與 `build-metadata.json`。
5. 確認 About 顯示 GPLv3、來源 URL 與 commit/tag/build state。
6. 建立 Git tag 後再製作公開 Release；正式二進位散布需自行處理 Developer ID 與 notarization。
