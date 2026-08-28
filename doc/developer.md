# FastFileViewer Developer Guide

## 專案定位

FastFileViewer 是 macOS 本機優先檔案工作台，可瀏覽一般資料夾與 ZIP、TAR、TGZ、TAR.GZ 內的圖片、文字、Markdown、程式碼、常見設定檔、影音及字幕，並可由使用者明確提供的公開網址下載內容。

核心能力：

- 不解壓縮直接瀏覽壓縮檔內容。
- 圖片 Viewer、Markdown Render、結構化資料與程式碼語法高亮整合於同一內容樹。
- 三區式內容工作區、格式篩選、釘選目錄、多選匯出及 SHA-256 完全重複偵測。
- 大型內容樹與縮圖使用本機磁碟快取；圖片使用容量受限 LRU 與相鄰預載。
- 掃描、Render、快取與內容分析完全在本機進行，不執行程式碼或 Markdown 原始 HTML。
- 本機影音採可跳轉串流，壓縮檔影音使用生命週期受控的暫存檔。
- MKV 在偵測到本機 `ffmpeg` 時，優先轉封裝並在必要時使用 VideoToolbox 轉碼成暫存 MP4。
- 音樂播放器透過 Web Audio API 的 `AnalyserNode` 繪製即時頻譜與波形，暫停時停止動畫更新；頻譜使用 32768-point floating-decibel FFT，以 72 個對數中心頻率線性插值，目標涵蓋 10 Hz–20 kHz，並受來源取樣率的 Nyquist 上限約束。波形依畫布寬度降採樣至最多 1,600 點。
- MP2／MP3、M4A／M4B、WAV、AAC、FLAC、OGG／OPUS、AIFF 與 CAF 優先原生播放；FLAC 等原生解碼失敗時自動要求相容 M4A。
- WMA、APE、WavPack、獨立 ALAC、AC-3、AMR 與 MKA 直接透過本機 `ffmpeg` 轉為 256 kbps AAC M4A 暫存檔；MKV 先嘗試改封裝，失敗時才使用 VideoToolbox 轉碼。
- MKV 改封裝完成後，使用者可選擇把可播放檔保存至原資料夾並將原檔移至垃圾桶；取消時維持原檔與暫存播放流程。
- 自動配對同目錄 sidecar 字幕，並轉換常見文字字幕格式供播放器顯示。
- 「下載項目」只對使用者明確貼上或拖入的公開 HTTP/HTTPS URL 建立連出連線，包含未加密且已結束的 HLS VOD。

## 開源身分

- Repository：`https://github.com/VaderChen/FastFileViewer`
- Go module：`github.com/VaderChen/FastFileViewer`
- 預設 Bundle ID：`com.vader.fastfileviewer`
- 開源授權：GPL-3.0-only
- 可選商業授權：`COMMERCIAL-LICENSE.md`
- 最低 macOS：12.0
- 架構：Apple Silicon arm64

公開版不啟用 App Sandbox，也不包含個人化設定。

## 技術組成

- 後端：Go 1.26.4
- 桌面框架：Wails 2.13.0
- 前端：React 18、TypeScript、Vite 8
- Markdown：`react-markdown`、`remark-gfm`
- 語法上色：`highlight.js`、`rehype-highlight`
- 圖示：Font Awesome
- 媒體相容工具：發布 App 內建 LGPL `ffmpeg`，用於 MKV 與非原生音訊；開發模式沒有 Bundle 時回退使用本機安裝版本，Repository 不包含預建二進位檔

## 主要目錄

- `main.go`：Wails 入口與視窗設定。
- `internal/app/app.go`：掃描、壓縮檔、圖片／文件載入、快取、匯出與重複偵測。
- `internal/app/media.go`：媒體註冊、Range 回應、壓縮檔媒體暫存與資產路由。
- `internal/app/download.go`：安全 URL 驗證、下載佇列、進度、持久化及 HLS VOD 合併。
- `internal/app/types.go`：前後端資料模型。
- `frontend/src/App.tsx`：內容樹、Viewer、工作區、設定與 About 授權資訊。
- 文件配色預設為 `GitHub Light`，使用者選擇透過 `localStorage` 持久化。
- `frontend/src/MediaPlayer.tsx`：影片與音訊播放、Web Audio 頻譜／波形、相容音訊 fallback、控制列及字幕掛載；音訊 BAR 的 `Colors` 狀態會控制是否以緩慢色相循環顯示。
- `frontend/src/mediaSupport.ts`：sidecar 字幕配對與 WebVTT 轉換。
- `frontend/src/useImageViewer.ts`、`frontend/src/imageLayout.ts`：圖片縮放、旋轉、置中、拖曳平移與版面計算。
- `frontend/src/useWorkspace.ts`、`frontend/src/libraryTree.ts`：內容工作區篩選、分批載入、選取、匯出、重複偵測與樹狀資料合併。
- `frontend/src/useDownloads.ts`、`frontend/src/downloads.ts`：下載佇列、網址／HLS 候選處理、拖放與下載狀態輪詢。
- `frontend/src/ThumbnailCard.tsx`、`frontend/src/format.ts`、`frontend/src/operations.ts`：縮圖卡片、格式化與可取消操作的共用前端邏輯。
- `frontend/src/styles.css`：版面與 Viewer 樣式。
- `scripts/generate-third-party-notices.mjs`：產生第三方套件清冊與完整授權文字。
- `scripts/write-build-metadata.mjs`：產生可追溯建置資訊。
- `build/darwin/Info.plist`：macOS production bundle 模板。

## 後端服務與 API

Wails 綁定三個服務，避免圖庫、媒體與下載佇列共用同一組生命週期狀態：

- `Library`（`App`）：目錄掃描、快取、文件／圖片載入、匯出、Checksum、重複偵測及可取消操作。
- `Media`（`MediaService`）：媒體註冊、Range 播放、壓縮檔媒體暫存、`ffmpeg` 相容轉換及播放快取清理。
- `Download`（`DownloadService`）：公開 URL 驗證、下載佇列、HLS VOD、持久化歷史與 Finder 操作。

`main.go` 由 `app.New()` 建立服務集合，透過 `Services.Startup`／`Services.Shutdown` 將同一個應用程式 context 傳給各服務，並以 `NewMediaMiddleware` 將受控媒體路由掛到 Wails asset server。

主要 API：

- `Bootstrap()`：回傳預設路徑及支援格式。
- `SelectDirectory(title)`：原生目錄選擇器。
- `BeginOperation()`／`CancelOperation(id)`／`FinishOperation(id)`：可取消作業生命週期。
- `ScanDirectory(...)`：掃描單層目錄並回傳壓縮檔警告。
- `LoadImageByPathWithOperation(...)`：支援取消的圖片讀取。
- `LoadThumbnailByPath(...)`：產生或讀取縮圖快取。
- `LoadDocumentByPath(...)`：讀取一般或壓縮檔內文件。
- `PrepareMediaByPath(...)`：驗證媒體路徑並建立受控本機播放網址。
- `PrepareCompatibleMediaByPath(...)`：原生音訊解碼失敗時，建立並註冊生命週期受控的 M4A 相容暫存檔。
- `ReleasePlaybackCache(...)`：釋放指定媒體的暫存播放檔。
- `ConfirmRemuxedOriginalCleanup(...)`：將 MKV 改封裝結果保存至原資料夾，並在成功後把原始檔移至垃圾桶。
- `StartDownload(url)`／`ListDownloads()`：建立下載及取得佇列狀態。
- `ResolveDownloadURL(url)`：讀取公開頁面的 HTML／inline script 並回傳最多 16 個 `.m3u8` 候選，不執行 JavaScript。
- `StartResolvedDownload(sourceURL, hlsURL, name)`：以來源頁推導的安全 Referer／Origin 建立已選取 HLS 的獨立下載。
- `CancelDownload(id)`／`RemoveDownload(id)`：取消下載或移除歷史紀錄，不刪除已完成檔案。
- `RevealDownload(id)`／`OpenDownloadsDirectory()`：在 Finder 顯示完成檔案或下載資料夾。
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
- 媒體網址只接受後端已註冊的項目 ID，不直接公開任意檔案系統路徑。
- 壓縮檔媒體暫存於作業系統暫存目錄，重新掃描或關閉程式時清理。
- 音訊相容轉換只讀取使用者已選取或掃描到的本機項目，不執行來源內容；轉換檔與 MKV 快取使用相同清理週期。
- URL 下載只接受 HTTP/HTTPS，拒絕 URL credentials、localhost、私有 IP、link-local、multicast、unspecified、CGNAT 與保留測試網段。
- 自訂 `DialContext` 在實際連線時重新解析並驗證 IP；每次 redirect 也重新驗證，且不使用環境 Proxy。
- 下載不使用 Cookie、登入狀態或自訂認證，不繞過 DRM、付費牆或加密串流。
- 一般單檔上限 4 GB；文字、HTML、HLS 播放清單上限 32 MB；HLS 上限 20,000 段且必須包含 `EXT-X-ENDLIST`。
- HLS master playlist 依 `BANDWIDTH` 選擇最高頻寬 variant；拒絕 `EXT-X-KEY` 加密內容，支援相對 URL、初始化片段及 byte range。
- 前端對單一網頁候選直接呼叫 `StartResolvedDownload`；複數候選顯示對話框供複選，確認後逐項建立下載。沒有候選時維持 HTML 下載。
- Resolver 不使用瀏覽器 Cookie 或模擬／繞過 Cloudflare 等反機器人驗證；401／403 會回傳明確提示，要求直接 `.m3u8`。
- 下載使用同目錄暫存檔及排他 hard link 完成，不覆寫既有檔案；目的地為 `~/Downloads/FastFileViewer`。
- 下載紀錄位於 `os.UserConfigDir()/FastFileViewer/downloads.json`，不保存 URL query 或 fragment；App 關閉時未完成項目下次啟動會標示為失敗。

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
APP_MARKETING_VERSION=1.26.0824 \
APP_BUILD_LABEL=1200 \
APP_BUNDLE_ID=com.example.fastfileviewer \
BUILD_SOURCE_URL=https://github.com/example/FastFileViewer \
./build.sh
```

本機發布環境可透過被忽略的 `.env.*` 設定檔覆寫建置參數；該檔不得提交至公開 Repository。

建置流程：

1. `go mod verify`、`go vet`、`go test -race`，包含 URL、重新導向、HLS、檔名及持久化測試。
2. 前端測試、production build 與 production dependency audit。
3. 產生 `THIRD-PARTY-NOTICES.md` 與 `THIRD-PARTY-LICENSES.txt`。
4. 在本機暫存目錄建立 Wails App。
5. 嵌入 GPLv3、第三方授權及 `build-metadata.json`。
6. 移除不屬於公開建置的本機發布資產並完成 App Bundle 封裝。
7. 完成 App Bundle 並輸出 `dist/FastFileViewer.app`。

## 授權清冊

手動更新：

```bash
node scripts/generate-third-party-notices.mjs
```

此命令會更新已追蹤的 `THIRD-PARTY-NOTICES.md`，並產生被 Git 忽略的 `THIRD-PARTY-LICENSES.txt`。完整文字會隨 App Bundle 發布。

## GitHub 公開前檢查

1. 確認 `cert/`、`build/bin/`、`dist/`、`frontend/dist/` 未加入 Git。
2. 搜尋 Token、個人絕對路徑與安裝包。
3. 執行完整 `./build.sh`。
4. 驗證 App 內含 `Contents/Resources/Licenses` 與 `build-metadata.json`。
5. 確認 About 顯示 GPLv3、來源 URL 與 commit/tag/build state。
6. 建立 Git tag 後再製作公開 Release，並核對下載檔。
