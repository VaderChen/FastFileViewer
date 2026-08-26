# FastFileViewer 專案快速閱讀

## 專案定位

FastFileViewer 是以 Go、Wails、React 與 TypeScript 建立的 macOS 本機優先檔案工作台。它可以分段掃描一般資料夾與 ZIP、TAR、TGZ、TAR.GZ，並在同一個內容樹中瀏覽圖片、文件、程式碼、結構化資料、影音與字幕。

檔案掃描、縮圖、文件 Render、媒體準備與內容分析都在本機完成。網路只在使用者明確將公開 HTTP/HTTPS 網址貼入或拖入「下載項目」時使用；下載器不攜帶 Cookie、登入狀態或自訂認證。

## 技術棧與專案結構

- Go 1.26.4：後端檔案、壓縮檔、媒體與下載服務。
- Wails 2.13.0：將 Go 服務綁定到 macOS 桌面視窗及前端 WebView。
- React 18、TypeScript、Vite 8：內容樹、Viewer、工作區、設定與下載介面。
- `react-markdown`、`remark-gfm`、`highlight.js`、`rehype-highlight`：Markdown 與程式碼預覽。
- 發布 App 內建的 LGPL `ffmpeg`：MKV 與非原生音訊的相容播放；開發模式沒有 Bundle 時才回退使用本機工具。公開 Repository 不包含預建二進位檔。

重要檔案：

- `main.go`：建立服務集合、設定 Wails 視窗、註冊媒體 middleware 與服務 Bind。
- `internal/app/app.go`：圖庫服務、目錄／壓縮檔掃描、圖片／文件讀取、快取、匯出及重複偵測。
- `internal/app/media.go`：媒體服務、Range 回應、壓縮檔媒體暫存、`ffmpeg` 改封裝／轉碼及播放快取。
- `internal/app/download.go`：下載服務、公開 URL 驗證、網頁中的 HLS 候選解析、VOD 合併、佇列與歷史紀錄。
- `internal/app/registry.go`：跨服務共用的項目註冊表與可取消操作註冊表。
- `internal/app/types.go`：Wails 前後端資料模型。
- `frontend/src/App.tsx`：主畫面組合、內容樹、Viewer、設定、About 與多語系訊息。
- `frontend/src/MediaPlayer.tsx`：影片／音訊播放、控制列、字幕、頻譜與波形。
- `frontend/src/useImageViewer.ts`、`frontend/src/imageLayout.ts`：縮放、旋轉、拖曳平移、置中與圖片版面計算。
- `frontend/src/useWorkspace.ts`、`frontend/src/libraryTree.ts`：內容工作區的篩選、選取、分批載入、匯出、重複偵測與樹狀合併。
- `frontend/src/useDownloads.ts`、`frontend/src/downloads.ts`：下載佇列、網址解析、HLS 候選選取、拖放與輪詢。
- `frontend/src/structuredViewers.tsx`：JSON 樹與 CSV／TSV 表格。
- `frontend/src/mediaSupport.ts`：sidecar 字幕配對、字幕格式轉 WebVTT 與下一首音訊搜尋。

## 後端服務邊界

`app.New()` 建立三個由 Wails 綁定的服務：

| 服務 | 實作 | 責任 |
| --- | --- | --- |
| `Library` | `App` | 掃描、索引快取、圖片／文件讀取、匯出、Checksum、重複偵測 |
| `Media` | `MediaService` | 受控媒體 URL、Range 播放、壓縮檔暫存、音訊相容轉換與清理 |
| `Download` | `DownloadService` | 公開 URL 下載、HLS VOD、進度、取消、歷史與 Finder 操作 |

`Services.Startup` 將 Wails 的生命週期 context 傳給三個服務；`Services.Shutdown` 取消未完成下載、停止媒體作業並清理暫存檔。媒體 middleware 只服務後端已註冊的項目 ID，不直接暴露任意檔案系統路徑。

## 資料模型

### `LibraryNode`

代表目錄或壓縮檔節點：

- `id`、`name`、`path`
- `kind`：`directory` 或 `archive`
- `scanned`
- `images`：目前名稱沿用舊模型，實際可包含圖片、文件、影音與字幕
- `children`

### `ImageEntry`

代表可被內容樹選取的項目：

- `id`、`name`、`path`、`directoryPath`
- `source`：`file` 或 `archive`
- `archivePath`、`innerPath`
- `format`、`kind`、`size`
- `kind`：`image`、`text`、`markdown`、`code`、`video`、`audio` 或 `subtitle`

壓縮檔內項目使用下列虛擬路徑：

```text
/path/to/archive.zip::inner/path/file.ext
```

### 下載模型

`DownloadItem` 保存去除 query 與 fragment 的 URL、檔名、狀態、進度、內容類型、輸出路徑與錯誤訊息。狀態包括 `queued`、`downloading`、`completed`、`failed`、`cancelled`。

## 掃描與快取流程

```text
選擇或輸入根目錄
  -> 讀取符合根目錄的本機索引快取
  -> ScanDirectory(root)
  -> 顯示根節點並將子目錄放入 queue
  -> 每次掃描一個目錄
  -> 合併節點、更新快取與 UI
  -> 預覽時才載入完整內容
```

掃描會依圖片、文件與媒體／字幕三組啟用格式篩選；壓縮檔只列出符合篩選的內部項目，不會先整批解壓縮。縮圖、相鄰圖片預載與完整圖片內容各自受大小及數量限制。

主要本機資料：

- 圖庫索引：`os.UserCacheDir()/FastFileViewer/library-cache-v3/`
- 縮圖快取：`os.UserCacheDir()/FastFileViewer/` 下的 PNG 檔
- 下載歷史：`os.UserConfigDir()/FastFileViewer/downloads.json`
- 下載檔案：`~/Downloads/FastFileViewer`
- 壓縮檔媒體、MKV 與相容音訊：作業系統暫存目錄，作業完成、重新掃描或 App 關閉時清理

## Viewer 與媒體流程

圖片 Viewer 支援 Fit、實際尺寸、放大、縮小、旋轉、拖曳平移與全螢幕。圖片顯示版面由 `imageLayout.ts` 計算，`useImageViewer.ts` 管理舞台尺寸、捲動位置與 pointer capture。

文件 Viewer 支援純文字、Markdown、程式碼、JSON、CSV 與 TSV。Markdown 的遠端 URL 與原始 HTML 不會載入或執行；大型 JSON、表格及程式碼也有顯示數量限制。

媒體流程：

1. `PrepareMediaByPath` 驗證項目並建立受控播放網址。
2. 本機媒體以 Range 回應支援跳轉；壓縮檔媒體先建立受控暫存檔。
3. MKV 先嘗試改封裝；若編碼不適合播放，再以 VideoToolbox 轉碼成暫存 MP4。
4. 改封裝成功後，使用者可選擇保存可播放檔並將原檔移至垃圾桶；取消則保留原檔與暫存播放。
5. WMA、APE、WavPack、獨立 ALAC、AC-3、AMR、MKA 等音訊由 `ffmpeg` 轉成暫存 M4A。
6. FLAC 優先使用 WebKit 原生解碼，失敗時才建立相容 M4A。
7. 同目錄同檔名的 VTT、SRT、ASS、SSA、SMI、文字型 SUB 會自動配對；必要時轉為 WebVTT。

音樂播放器保留切換圖片／文件時的播放位置、播放狀態、音量及靜音狀態；切換影片時會暫停背景音樂。播放結束後會跳到目前內容順序中的下一個音訊項目，跳過非音訊項目並循環。視覺化使用 32768-point floating-decibel FFT、72 個對數中心頻率與最多 1,600 個波形點。

## 下載流程與安全界線

使用者可以在「下載項目」貼上或拖入一個或多個公開 HTTP/HTTPS URL。前端會先判斷一般檔案或網頁，再呼叫 `StartDownload` 或 `ResolveDownloadURL`：

- 網頁解析器只掃描最多 32 MB HTML／inline script，不執行 JavaScript，最多回傳 16 個 `.m3u8` 候選。
- 一個候選會直接加入下載；多個候選顯示複選對話框，每個選取項目建立獨立下載。
- HLS 僅接受未加密、已結束的 VOD；master playlist 選最高 `BANDWIDTH` variant，支援相對 URL、初始化片段與 byte range。
- 每個初始網址、重新導向及連線時 DNS 解析都會拒絕 localhost、私有、link-local、multicast、CGNAT、保留測試網段及其他非公開位址。
- 不使用 Cookie、登入狀態、Authorization 或環境 Proxy，也不繞過 DRM、付費牆、Cloudflare／反機器人驗證及加密／即時 HLS。
- 單檔上限 4 GB；文字、HTML 與播放清單上限 32 MB；HLS 最多 20,000 個片段。
- 下載先寫入同目錄 `.part` 暫存檔，完成時以不覆寫既有檔案的方式提交；取消或失敗會清理暫存檔。

## 設定與持久化

設定頁包含顯示、圖片格式、文件格式、媒體／字幕格式與 About：

- 語言：自動、繁體中文、English、日本語。
- 背景：淺灰、白、深灰、黑、格紋。
- 縮放：符合顯示區域、大圖才縮小、鎖定比例。
- 文件主題：GitHub Dark、GitHub Light、Atom One Dark、Nord、Monokai。
- 釘選資料夾、目前／釘選／下載來源頁籤、左側欄寬度與收合狀態。

設定與內容選取使用 `fastfileviewer.*` 命名的 `localStorage` key；圖庫索引格式目前為 `fastfileviewer.libraryCache.v3`，變更模型時應提高版本並保留舊資料的安全失敗行為。

## 建置與發布

公開開源版的預設設定：

- App：`FastFileViewer`
- Bundle ID：`com.vader.fastfileviewer`
- 最低 macOS：12.0
- 架構：Apple Silicon arm64
- 公開 `build.sh`：不啟用 App Sandbox，使用 ad-hoc 或指定的本機簽章身份
- App 產物：`dist/FastFileViewer.app`

開發模式：

```bash
./run.sh
```

公開建置：

```bash
./build.sh
```

建置會檢查 Go、前端相依套件、production build、測試與 audit，並將 GPLv3、第三方授權全文、通知及 `build-metadata.json` 放入 App Bundle 的 `Contents/Resources`。

正式 DMG 流程：

```bash
./package-dmg.sh
```

此流程要求已追蹤工作樹乾淨、HEAD 具有 `v1.2.3` 格式的精確 tag、Developer ID Application 簽章身份，並預設要求 Apple Notary Service 與 stapling。`SKIP_NOTARIZATION=1` 僅適合本機驗證，不可作為公開發布產物。

`package-appstore.sh` 是獨立的 App Store／TestFlight 打包流程，不由公開 `build.sh` 呼叫；使用前必須核對腳本中的 App 名稱、Bundle ID、Team ID、憑證與 provisioning profile，避免把非公開發布設定帶入 Repository。

## 已知限制與檢查項目

- HEIC 是否能顯示取決於 WebKit 與 macOS 的原生支援。
- 壓縮檔歷史編碼可能仍無法完全還原檔名。
- 發布 App 已內建 LGPL `ffmpeg`；僅在開發模式沒有 Bundle 且未安裝本機工具時，MKV 與非原生音訊可能無法播放。
- App 只對使用者主動選取的位置匯出；下載器則固定寫入 `~/Downloads/FastFileViewer`。

修改後的最低檢查：

```bash
gofmt -w main.go internal/app/*.go
go test ./...
cd frontend && npm run build
```

若修改建置或發布流程，再依序檢查 `./build.sh`、App Bundle 授權檔、`build-metadata.json`、簽章、notarization 與 SHA-256 校驗檔。
