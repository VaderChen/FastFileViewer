# 函式層級檢查與最佳化（2026-10-03）

後續包含更新流程、狀態輪詢、HLS 解析、掃描及表格排序的再次檢查，見[第二次全專案函式檢查](function-optimization-followup.md)。本文保留前次的量測與驗證記錄。

本輪以目前專案自有程式碼為範圍，檢查函式的呼叫頻率、遍歷次數、暫時配置、資源生命週期及錯誤路徑。UI、操作、功能、認證、排序與格式判定維持原有行為。

## 範圍與方法

以 Go parser 與 TypeScript AST 建立函式清單，再按模組檢查呼叫關係。調整後的自有程式碼共有：

- Go：21 個含函式的檔案，299 個具名函式／方法、38 個匿名函式；包含平台分支。
- 前端 `src`：777 個具有實作的函式／回呼，包含 React 元件、effect 與事件處理器。
- JavaScript／TypeScript 建置工具：35 個函式／回呼；版本控制內的 shell 腳本另有 5 個具名輔助函式。

這是盤點數量，不是修改或逐一效能量測的數量。型別宣告、自動產生的 Wails 橋接、第三方依賴、測試及基準不列入正式程式碼的函式統計；入口、組態、建置與清理流程亦納入檢查。

| 模組 | 檢查重點與處置 |
| --- | --- |
| `main.go`、操作登錄與檔案平台輔助函式 | 啟動／關閉、取消、鎖定及 FD 生命週期；保留既有有界資源與檔案識別檢查 |
| `app.go`、`document.go` | 掃描、項目建立、壓縮檔建樹、文字解碼、雜湊 ID；減少重複副檔名判定及中間配置 |
| `download.go` | HLS 選流、分段複製、URL／屬性解析及清單移除；改為單次選擇、共用下載緩衝與直接解析 |
| `media.go`、`image_http.go` | 準備、轉檔、串流、快取失效與取消；維持串流、來源識別及請求生命週期 |
| `fileops.go`、`name_sort.go` | 複製、搬移、刪除、去重與排序；沿用已有的緩衝重用與排序比較 |
| ZIP／TAR、縮圖解碼與磁碟快取 | 讀取上限、索引、LRU、使用中淘汰與工作區釋放；保留既有容量及並行預算 |
| `App.tsx`、`libraryView.ts` | 掃描、選取、預取及文件顯示；減少整份清單的 ID 配置，避免相同文件重複上色 |
| `MediaPlayer.tsx`、`mediaSupport.ts` | 每幀頻譜、字幕選擇及音訊圖生命週期；預計算頻率位置、重用振幅陣列、單次選出字幕 |
| 圖庫樹、工作區、篩選與掃描佇列 | 保留按需複製、批次合併、弱鍵統計快取、FIFO 與可取消處理 |
| 圖片傳輸、縮圖卡片與虛擬網格 | 保留請求去重、離屏取消、容量限制與可視列掛載 |
| 文件安全、結構化資料及顯示工具 | 保留內容／列數上限、穩定排序、Unicode 與原有截斷語義 |
| 建置、相依套件及檢查工具 | 檢查串流讀取、輸出清理、錯誤回報及最低 OS 目標；流程與依賴版本不變 |

原版演算法保存在測試專用 reference helper，使用同一輸入逐項對照輸出。正式程式不引用這些 helper。對於已受限且沒有明確收益的流程，保留既有實作。

## 函式變更

### Go

- `ScanDirectory`、`entryByPath` 與 `buildFileImageEntryWithExtension` 共用已取得的副檔名；`buildArchiveImageEntry` 也只判定一次。`normalizedExtension` 的 `.tar.gz` 判定只處理尾端，不先將整個路徑轉小寫。
- `addArchiveImageToNode` 使用 `SplitSeq`，只有建立新子節點時才組合虛擬路徑；既有祖先不再反覆產生累積路徑字串。子節點索引仍保存 slice 下標。
- `shouldIgnoreArchiveEntry` 逐段走訪；`splitArchiveEntryPath` 使用 `Cut`，保留第一個分隔符號及原有路徑正規化語義。
- `normalizeLineEndings` 沒有 CR 時直接回傳原字串；有 CR 時只配置一次輸出，保留 CRLF、單獨 CR、無效 UTF-8 及空輸入的結果。
- `decodeUTF16Document` 直接讀取 code unit 並寫入字串，省去完整 `[]uint16` 與 rune 中間資料。大小端、BOM、奇數長度、代理對與孤立代理碼元維持相同處理。
- `normalizeArchiveEntryName` 逐個解碼並保留嚴格最高分結果，移除候選陣列及去重 map；同分仍由原來先出現的候選勝出。一般文件編碼候選的選擇流程保持不變。
- `hashID` 使用固定大小 digest 工作區，少一次配置；ID 內容與 NUL 分隔方式不變。
- `downloadHLS` 線性選出最高頻寬，保留同分第一筆；同次下載共用一個 256 KiB 複製緩衝。
- `copyDownloadBodyWithBuffer` 共用原本的取消、寫入、大小與進度邏輯；`copyDownloadBody` 保留既有呼叫方式。
- `extractEmbeddedHLSURLs` 重用不可變的替換器；`parseHLSAttributes` 直接寫入結果 map，省去分段陣列。候選順序、數量上限、重複鍵及未閉合引號行為不變。
- `removeDownloadID` 清空壓縮後 slice 尾端的字串參照，讓移除項目的記憶體可回收。

### 前端

- `createLogSpectrumCalculator` 在音訊顯示 effect 建立時預先計算 72 個取樣位置，之後每幀覆寫同一振幅陣列。公開的 `calculateLogSpectrumAmplitudes` 仍回傳獨立陣列。
- `drawAudioVisualization` 只讀取目前模式需要的 analyser 資料；頻譜、波形、混合模式的繪圖指令與原版相同。
- `findSidecarSubtitle` 用單次走訪取代篩選後排序；保留相同目錄／來源、壓縮檔限制、精確檔名、格式順位、locale 比較及穩定同分順序。
- `reconcileVisibleSelection` 只收集可見且已選取的 ID；保留插入順序、新 Set 身分及第一筆回退。App 範圍選取直接走訪導覽區間，不先建立完整 ID 陣列。
- `CodeHighlight` 以 `[code, language]` 保存本次文件的上色結果；其他狀態更新不重做相同文字的正規化、上色與分行。原有內容與行數限制維持不變。

## 受控基準

Apple M4、darwin/arm64、Go 1.26.6、Node 24.14.0。Go 使用 `-benchmem -benchtime=300ms`；前端時間取暖機後 5 組樣本的中位數。正式版與原版 helper 在同一機器、同一測試資料下比較。

| 情境 | 調整前 | 調整後 |
| --- | ---: | ---: |
| 5,000 筆共用六層目錄的壓縮檔建樹 | 2.105 ms | 0.937 ms |
| 同上，配置次數 | 60,052 allocs/op | 59 allocs/op |
| 同上，配置量 | 5.31 MB/op | 3.63 MB/op |
| 256 個 4 KiB HLS 分段的純複製配置 | 64.01 MiB/op | 268 KiB/op |
| 461-byte 路徑的副檔名判定 | 1,136 ns、504 B/op | 54.7 ns、24 B/op |
| 176 KiB 混合換行字串正規化 | 0.376 ms、336 KiB/op | 0.278 ms、168 KiB/op |
| 約 176 KiB UTF-16 ASCII 輸入解碼 | 0.568 ms、2.25 MB/op | 0.264 ms、0.180 MB/op |
| 約 144 KiB UTF-16 中文輸入解碼 | 0.515 ms、1.87 MB/op | 0.303 ms、0.336 MB/op |
| 含跳脫符號的 HLS URL 擷取 | 47 allocs/op | 19 allocs/op |
| 單次雜湊 ID | 168 B/op、4 allocs/op | 144 B/op、3 allocs/op |
| 72 柱頻譜振幅計算 | 5.77 µs | 1.78 µs |
| 20,000 筆字幕皆符合的候選選擇 | 3.278 ms | 0.854 ms |
| 50,000 筆清單保留 1 個選取 ID | 1.014 ms | 0.098 ms |
| 同一份 1,000 行程式碼再次渲染 | 14.83 ms | 1.28 ms |

最後一項包含元件函式建立 React 元素，不包含 DOM 提交或原生 WebView 繪製。建樹基準不包含讀取壓縮檔、建立檔案項目與排序。HLS 基準不包含 HTTP、磁碟或解碼，不能將緩衝配置改善解讀為實際下載速度倍數。

Go B/op 為累計配置量，不是常駐記憶體或峰值 RSS。前端基準另輸出單次呼叫前後的 heap 增量，受 GC 與執行器影響，僅供定位配置來源。既有一般文件編碼選擇基準約 2.76／2.79 ms、2.736 MB/op，未觀察到改善，不列為加速成果。

取捨：音訊 effect 會在存活期間保留三個 72 格數字陣列；每次 HLS 下載保留一個 256 KiB 緩衝至結束或取消；上色元件保留目前文件的預覽與上色分行直到內容替換或卸載。這些都受既有生命週期約束，沒有新增全域無界內容快取。

## 驗證

- 前端 146 項測試全部通過；Go 186 項一般測試與 2 個 fuzz 種子套件全部通過，無跳過。
- Go 全套啟用 race detector，`internal/app` statement coverage 為 74.5%；新增文字相容性 fuzz 執行約 10 秒、55,451 組輸入通過。
- UTF-16 比對涵蓋全部 65,536 個 code unit、三種後續碼元及大小端；另以隨機位元組比較換行、副檔名、舊編碼檔名與文件解碼。
- HLS 測試涵蓋同頻寬選流、大／小分段接續、共用緩衝、進度、取消、讀寫錯誤、短寫及大小限制。
- 前端比對逐柱振幅、三種模式的 Canvas 指令、analyser 呼叫數、RAF／事件釋放、字幕同分排序、選取順序及上色重新計算邊界。
- App 與 MediaPlayer 的 JSX 結構逐段比對一致，樣式檔未變；TypeScript／Vite production build、Go vet、desktop／production 原生編譯通過，arm64 最低 macOS 版本維持 12.0。

本輪未量測原生 WebView 長時間 RSS，未重做原生介面人工操作或發行封裝驗證；FFmpeg／ffprobe 回歸沿用受控替身。函式基準不構成整體 App 效能或所有輸入情境的最佳值保證。

重跑基準與回歸：

```sh
npm --prefix frontend run build
npm --prefix frontend test
GOTOOLCHAIN=go1.26.6 go test -race ./...
GOTOOLCHAIN=go1.26.6 go vet ./...
GOTOOLCHAIN=go1.26.6 go test ./internal/app -run '^$' -bench '^BenchmarkFunction' -benchmem -benchtime=300ms
GOTOOLCHAIN=go1.26.6 go test ./internal/app -run '^$' -fuzz '^FuzzFunctionTextCompatibility$' -fuzztime=10s -parallel=4
cd frontend
node --expose-gc --max-semi-space-size=256 benchmarks/media-functions.mts
node --expose-gc --max-semi-space-size=256 benchmarks/view-functions.mts
```
