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
- MKV 透過內建 LGPL `ffmpeg` 優先轉封裝，並在必要時使用 VideoToolbox 轉碼成暫存 MP4；開發模式沒有 Bundle 時使用本機 `ffmpeg`。
- 音樂播放器透過 Web Audio API 的 `AnalyserNode` 繪製即時頻譜與波形，暫停時停止動畫更新；頻譜使用 32768-point floating-decibel FFT，以 72 個對數中心頻率線性插值，目標涵蓋 10 Hz–20 kHz，並受來源取樣率的 Nyquist 上限約束。波形依畫布寬度降採樣至最多 1,600 點。
- MP2／MP3、M4A／M4B、WAV、AAC、FLAC、OGG／OPUS、AIFF 與 CAF 優先原生播放；FLAC 等原生解碼失敗時自動要求相容 M4A。
- WMA、APE、WavPack、獨立 ALAC、AC-3、AMR 與 MKA 直接透過本機 `ffmpeg` 轉為 256 kbps AAC M4A 暫存檔；MKV 先嘗試改封裝，失敗時才使用 VideoToolbox 轉碼。
- MKV 改封裝完成後，使用者可選擇把可播放檔保存至原資料夾並將原檔移至垃圾桶；取消時維持原檔與暫存播放流程。
- 自動配對同目錄 sidecar 字幕，並轉換常見文字字幕格式供播放器顯示。
- 「下載項目」只對使用者明確貼上或拖入的公開 HTTP/HTTPS URL 建立連出連線，包含未加密且已結束的 HLS VOD。
- App 啟動時自動查詢 GitHub 正式新版，關於頁面提供手動偵測；使用者確認後下載並自動安裝、重啟，全程顯示進度。

## 專案身分

- Repository：`https://github.com/VaderChen/FastFileViewer`
- Go module：`github.com/VaderChen/FastFileViewer`
- 預設 Bundle ID：`com.vader.fastfileviewer`
- 專案授權：`LICENSE.md`（原始碼公開・禁止商業販售授權 1.1）
- 授權政策：`COMMERCIAL-LICENSE.md`
- 最低 macOS：12.0
- 架構：Apple Silicon arm64

公開版不啟用 App Sandbox，也不包含個人化設定。

## 技術組成

- 後端：Go 1.26.6（build.sh／run.sh 依 go.mod 的 go 版本選用工具鏈，避免本機升級後改變 macOS 最低要求）
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
- `internal/app/metadata.go`：圖片尺寸／EXIF、影音 ffprobe metadata，以及 macOS 原生 RAW 轉換預覽。
- `assets/file-icons/`：Finder 檔案關聯的預設分類圖示樣式；`FASTFILEVIEWER_FILE_ICON_STYLE` 控制 `build.command` 選用的樣式。
- `internal/app/download.go`：安全 URL 驗證、下載佇列、進度、持久化及 HLS VOD 合併。
- `internal/app/update.go`：更新偵測、下載／準備狀態、取消與應用程式生命週期。
- `internal/updater`：GitHub 正式版本比較、串流下載、安裝包驗證及獨立安裝視窗；`frontend/src/useAppUpdates.ts`、`AppUpdateDialog.tsx` 管理 App 內的更新流程。
- `internal/app/types.go`：前後端資料模型。
- `frontend/src/App.tsx`：內容樹、Viewer、工作區、設定與 About 授權資訊。
- 文件配色預設為 `GitHub Light`，使用者選擇透過 `localStorage` 持久化。
- `frontend/src/MediaPlayer.tsx`：影片與音訊播放、Web Audio 頻譜／波形、相容音訊 fallback、控制列及字幕掛載；音訊 BAR 的 `Colors` 狀態會控制是否以緩慢色相循環顯示。
- `frontend/src/mediaSupport.ts`：sidecar 字幕配對與 WebVTT 轉換。
- `frontend/src/useImageViewer.ts`、`frontend/src/imageLayout.ts`：圖片縮放、旋轉、置中、拖曳平移與版面計算。
- `frontend/src/useWorkspace.ts`、`frontend/src/libraryTree.ts`：內容工作區篩選、分批載入、選取、匯出、重複偵測與樹狀資料合併。
- `frontend/src/libraryView.ts`、`frontend/src/scanQueue.ts`：可見圖庫推導、分類統計、相鄰圖片收集與分塊掃描佇列。
- `internal/app/bounded_read.go`、`internal/app/name_sort.go`：有界讀取的容量提示與低配置檔名比較。效能基準與限制見 [performance.md](performance.md)。
- `frontend/src/useDownloads.ts`、`frontend/src/downloads.ts`：下載佇列、網址／HLS 候選處理、拖放與下載狀態輪詢。
- `frontend/src/ThumbnailCard.tsx`、`frontend/src/format.ts`、`frontend/src/operations.ts`：縮圖卡片、格式化與可取消操作的共用前端邏輯。
- `frontend/src/styles.css`：版面與 Viewer 樣式。
- `scripts/build-codec-deps-macos.sh`：固定 Opus／libvpx 版本與來源 SHA-256，建立 macOS 12 arm64 動態函式庫。
- `scripts/check-macos-target.mjs`：檢查影音工具與動態函式庫的 arm64 最低 macOS 版本。
- `scripts/generate-third-party-notices.mjs`：產生第三方套件清冊與完整授權文字。
- `scripts/write-build-metadata.mjs`：產生可追溯建置資訊。
- `build/darwin/Info.plist`：macOS production bundle 模板。

## 後端服務與 API

Wails 綁定五個服務，各自管理對應功能的生命週期狀態：

- `Library`（`App`）：目錄掃描、快取、文件／圖片載入、匯出、Checksum、重複偵測及可取消操作。
- `Media`（`MediaService`）：媒體註冊、Range 播放、壓縮檔媒體暫存、`ffmpeg` 相容轉換及播放快取清理。
- `Download`（`DownloadService`）：公開 URL 驗證、下載佇列、HLS VOD、持久化歷史與 Finder 操作。
- `File`（`FileService`）：重新命名、搬移、移至垃圾桶及檔案操作確認。
- `Update`（`UpdateService`）：版本偵測、下載／準備、取消與安裝交接。`GetUpdateProgress` 回傳精簡進度；`GetUpdateState` 保留完整發行資訊，供標籤變動時取得說明。前端只在內容有變化時替換狀態，詳細量測見[再次函式檢查](function-optimization-followup.md)。

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
- 圖片讀取上限 128 MB；縮圖來源上限 64 MB。SVG／HEIC 保留瀏覽器解碼例外，同樣套用位元組上限。
- 縮圖磁碟快取在每次寫入後限制 1,200 筆與 256 MiB；媒體快取以來源檔案識別、大小與修改時間檢查失效。
- JSON 預覽最多 10,000 個節點、64 層；收合分支延後渲染，渲染錯誤提供原始文字備援。
- 檔案移動／改名採不可覆寫操作；MoveResult.originalIds 以新 ID 對應原 ID，批次操作回傳部分失敗原因。
- 跨磁碟備援搬移保留連結、權限與修改時間；完成前可取消，實際搬移完成後回報成功。回滾前核對目的檔身分。
- 媒體清理先取消正在進行的工作；準備、保存、釋放共用可取消項目鎖。影音／PDF 串流取得 FD 後釋鎖，避免整段播放阻塞其他操作。
- FFmpeg 發行工具必須成功回傳版本與組態資訊，才可繼續封裝。
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

1. 透過 `scripts/prepare-wails-cli.mjs`，依 `go.mod` 準備相同版本的 Wails CLI，快取於 `build/tools/<version>/signing-<hash>/wails`。
2. 依 `package-lock.json` 將前端依賴直接安裝至 `frontend/node_modules`。
3. 在專案目錄啟動 Wails dev，由 Wails／Vite 監看原始碼並熱更新。

`run.sh` 與 `build.sh` 共用 CLI 準備流程。首次使用時，將 Wails 原始碼複製至暫存目錄，以 Go overlay 加入 `scripts/wailscompat/appledouble.go`；完成後刪除暫存來源，保留 CLI 快取，不修改共用 Go module cache。版本或修正內容改變時會重新建置 CLI。

相容修正在每次 App 封裝完成後、原本的 `codesign` 執行前，僅清理生成 Bundle 內具有 AppleDouble v2 標頭的 `._` 中繼檔；保留一般同名前綴檔案，不追蹤符號連結。ExFAT 可能在編譯期間重新產生這些檔案，因此啟動前清除或只執行 `xattr -rc` 並不足夠。原始碼位置、簽章流程及 Wails 熱更新維持不變；Wails 簽章程式碼不符合預期時，準備流程會明確失敗。

正式 App 加入影音工具、授權與建置資訊後，`build.sh` 會在最終 Bundle 簽章前執行 `scripts/clean-bundle-metadata.mjs`，清除後續複製及內層簽章重新產生的 AppleDouble。清理同樣限定於 App 內、驗證檔案標頭且不跟隨符號連結；一般 `._` 檔案保留。

## 公開版建置

```bash
./build.sh
```

後續版本統一使用 `1.YY.MMDD build HHmm`，例如 `1.26.1003 build 2059`。日期與時間取同一次建置開始時的本地時間，`HHmm` 使用 24 小時制並保留前導零；App About、前端版本與 `build-metadata.json` 的 `version` 都使用完整顯示格式。

Git tag 使用不含空白的 `1.YY.MMDD-build-HHmm`，例如 `1.26.1003-build-2059`。macOS 的數字版本欄位維持 `1.YY.MMDD` 與 `1.YY.MMDD.HHmm`。正式發行時固定同一組日期、時間與 tag，詳見[發行規範](release.md)。

可覆寫參數：

```bash
APP_MARKETING_VERSION=1.26.1003 \
APP_BUILD_LABEL=2059 \
APP_BUNDLE_ID=com.example.fastfileviewer \
BUILD_SOURCE_URL=https://github.com/example/FastFileViewer \
./build.sh
```

本機發布環境可透過被忽略的 `.env.*` 設定檔覆寫建置參數；該檔不得提交至公開 Repository。

建置流程：

1. `npm ci` 後先建立前端 production assets，確保 Go embed 在乾淨工作目錄中也有輸入。
2. `go mod verify`、`go vet`、`go test -race`，再執行前端測試與 production dependency audit。
3. 產生 `THIRD-PARTY-NOTICES.md` 與 `THIRD-PARTY-LICENSES.txt`。
4. 在專案目錄建置，產生 `build/bin/FastFileViewer.app`。
5. 嵌入專案的 `LICENSE*.md`、第三方授權及 `build-metadata.json`。
6. 移除不屬於公開建置的本機發布資產並完成 App Bundle 封裝。
7. 完成 App Bundle 並輸出 `dist/FastFileViewer.app`。

`./clean.sh` 僅清除專案內的建置產物及 Wails CLI；保留 `frontend/node_modules`，不刪除系統暫存快取。

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
5. 確認 About 的授權說明與 `LICENSE.md` 一致，並顯示來源 URL 與 commit/tag/build state。
6. 建立 Git tag 後再製作公開 Release，並核對下載檔。

## 3D 檔案預覽

設定順序為「顯示 → 影像檔案 → 文件檔案 → 程式語言 → 3D 檔案 → 媒體與字幕 → 關於」。模型格式使用獨立的 `enabledModelExtensions.v1` 本機設定，預設全選；修改後在下一次掃描套用。掃描結果的 `kind` 為 `model`，工作區可單獨篩選，圖庫快取可保留模型項目。

- `internal/app/model.go` 提供 `PrepareModelByPath` 與 `/model/<id>/<resource>`。本機檔案使用 `os.Root` 限制模型目錄邊界並串流讀取；壓縮檔沿用既有 ZIP／TAR 讀取器，最多同時保留兩份資源緩衝區。主檔與依賴皆限 128 MiB，只接受模型、材質、緩衝區與指定貼圖格式。
- `ModelPreview.tsx` 管理載入、取消、重試與多語介面。`modelViewer.ts` 在首次選取模型時動態載入；Three.js 核心與格式解析器分開封裝，只載入目前檔案需要的解析器。圖片與文件瀏覽不必先載入 3D 引擎；開啟 STL 不會預先載入 glTF、FBX 或 3MF 解析器。
- `modelLoaders.ts` 處理 GLB／glTF 2.0、OBJ＋MTL、STL、PLY（網格與點雲）、FBX 與 3MF。glTF 支援 Meshopt；Draco、KTX2 與動畫播放未啟用。MTL 的貼圖依各 MTL 所在目錄解析；所有外部資源仍必須留在模型目錄內。模型中指向遠端或其他本機路徑的資源不會連出讀取。
- 相機依模型邊界置中並縮放，支援左鍵旋轉、右鍵或 Shift＋左鍵平移、滾輪縮放及重設。靜態場景的世界矩陣只在準備完成時更新；操作時由相機改變視角。共用材質與幾何緩衝區只檢查一次，只有使用場景環境光的材質才建立環境圖。
- 靜止、背景及等待模型完成時不持續繪圖；同一幀的多次變更合併處理。ResizeObserver 與視窗 resize 事件共用尺寸檢查，只在實際尺寸或像素倍率改變時配置繪圖緩衝區。像素倍率最多 2，畫布最長邊最多 4096 像素。
- 已知長度的模型下載直接填入一份目的緩衝區；缺少或不準確的長度仍以串流上限檢查。進度只在整數百分比改變時通知介面，避免每個小資料區塊都觸發 React 更新。
- 單一預覽最多 500 萬個幾何頂點、256 MiB 幾何緩衝區、32 Mi 個貼圖像素及 256 個資源 URL。glTF 配置宣告、PLY 元素數與 3MF 解壓大小會先驗證。選取變更或預覽關閉時取消讀取，釋放幾何、材質、貼圖、ImageBitmap、骨架、環境圖、Object URL 與 WebGL context；延遲完成的結果也會釋放。
- `modelDisposal.ts` 使用弱參照集合記錄已釋放的共用資源。關閉預覽時立即清空場景與材質集合，只保留尚未完成的貼圖處理；延遲完成的圖片會立即回收，不反覆巡覽整個場景，也不重複關閉相同 ImageBitmap。

驗證包含 `go test -race ./...`、`npm test`、`npm run build`，以及原生 macOS WebKit 的七種格式渲染、一般目錄與 ZIP 的相對貼圖、缺少貼圖提示、滑鼠操作、視角重設、靜止不重繪與取消／關閉回收。瀏覽器檢查同時使用 HTTP 與 App 的 `wails://` URL scheme。

3D 效能比較可在 `frontend` 執行 `node --expose-gc benchmarks/model-preview.mts`。本機合成測試中，64 MiB 輸入串流的 ArrayBuffer 用量由約 128 MiB 降至 68 MiB，進度通知由 1,024 次降至 101 次；5,000 個共用幾何／材質網格的檢查中位數由約 4.13 ms 降至 0.82 ms。前者只衡量輸入緩衝區，不代表整個 App、WebKit 或 GPU 的總記憶體；實際時間依模型與硬體而異。13 組原生 WebKit 比較涵蓋七種格式、點雲、不受光材質與貼圖情境，修改前後畫素一致，並驗證旋轉、平移、縮放、重設及快速取消。
