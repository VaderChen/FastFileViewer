# FastFileViewer 深度檢查（2026-09-20）

## 第六輪：封存建樹、名稱一致性與圖庫快取（2026-09-21）

維持既有介面、正常操作流程、認證方式與排序規則；本輪只修改本機。

| 範圍 | 原問題與修正 |
| --- | --- |
| 封存建樹 | 每插入一個資料夾都線性掃描同層節點，大量同層資料夾時成本接近平方成長。改用每次建樹專用的名稱索引，保存 slice 下標，避免擴容造成指標失效；完成後釋放索引。 |
| 掃描取消 | 封存項目列舉完成後，建樹與遞迴排序原本不檢查取消。現在組裝逐項檢查，排序採明確堆疊並在節點間檢查，保留穩定排序。 |
| 同名項目 | ZIP／TAR 同一正規化名稱可能列出多次，特殊項目亦可能遮住真正檔案。掃描、索引與串流讀取統一取第一個可讀檔案，略過符號連結與 FIFO 等特殊項目；保留稀疏檔案串流備援。 |
| Unicode 名稱 | 已是合法 UTF-8 的名稱仍被當成舊編碼猜測，導致部分中文與重音字元變形。先保留合法 UTF-8，其他資料維持原有舊編碼解碼流程。 |
| TAR 快取版本 | 來源在建立索引期間原地修改或被替換，原本仍採用該索引。完成前核對開啟 FD 與目前路徑的版本；不一致時回報錯誤並清除半成品。 |
| 圖庫快取 | 原本只驗證外層，損壞的子節點可能使載入失敗。以迭代方式驗證節點、檔案欄位、唯一 ID、深度與快取 metadata；不合法時沿用重新掃描流程。 |

驗證結果：

- 新增 11 項 top-level 回歸測試（Go 6、前端 5）；Go 共 **167 項**、前端共 **105 項**通過，均無跳過。
- Go 1.26.6 race detector 與 vet 通過；internal/app statement coverage **72.8%**。
- TypeScript／Vite production build、desktop／production 原生編譯及 diff 空白檢查通過。原生執行檔為 arm64，最低 macOS 版本仍為 12.0。
- 修正前重現同名項目／特殊項目讀取不一致、建樹未取消、Unicode 名稱變形、損壞快取載入失敗及 TAR 建立索引期間的來源變動。測試另涵蓋正常巢狀圖庫、分支擴容、排序、循環／過深資料及重複 ID。
- Apple M4、Go 1.26.6、6,000 個不同同層資料夾，各含一張圖片，完整建樹加排序的微型基準（3 次）：**45.87 → 2.92 ms/op**，約 15.7 倍；**5,798,658 → 6,390,192 B/op**，每次額外配置約 0.59 MB。這是名稱索引以暫時記憶體換取查找效率的結果，不是整體 App 加速或 RSS 降低的保證。

重跑建樹基準：

```sh
GOTOOLCHAIN=go1.26.6 go test ./internal/app -run '^$' -bench BenchmarkWideArchiveTree -benchmem -benchtime=3x
```

修改前保留 .bak，驗證後移除本輪備份、測試暫存與前端建置產物；既有 App／DMG、模型及其他未提交修改保留，未同步 GitHub。

驗證界限：未重新執行原生 WebView 的互動與長時間 RSS 量測；FFmpeg／ffprobe 測試使用受控替身，完整 Wails 發行封裝仍缺少 third_party/ffmpeg。來源版本檢查防護一般並行異動，不提供檔案系統交易保證；排序中的單一大型節點仍須完成該次同步排序才處理取消。

## 第五輪：服務關閉、檔案一致性與播放器資源（2026-09-21）

| 範圍 | 原問題與修正 |
| --- | --- |
| 服務關閉與縮圖 | 沒有 UI 操作 ID 的讀取原本使用 Background，關閉服務後仍繼續，等待縮圖 slot 亦無法取消。所有操作現在承接服務生命週期；Shutdown 取消並清除操作登錄，之後的新 ID 視為取消。縮圖 slot、像素預算、圖片／文件讀取均接入取消。更換父 context 時取消舊工作，延遲 Finish 不會清除新工作。 |
| 下載生命週期 | DNS／網頁解析階段尚未建立下載 ID，原本不受關閉影響，稍後仍可能排入佇列。驗證及下載共用服務 context，關閉後拒絕新工作，已取消的工作不再建立下載目錄或啟動傳輸。歷史讀取拒絕 FIFO。 |
| 下載錯誤與 Finder | 網路錯誤保存至歷史前，移除 URL 的帳密、查詢字串與 fragment，保留診斷訊息。開啟下載目錄／顯示檔案會等待並回收 open 子程序，也能回報其退出錯誤。 |
| 舊檔案 ID | 改名、搬移及移至垃圾桶成功後移除舊登錄，避免舊圖片 URL 讀到原路徑後來建立的其他檔案；失敗操作保留原登錄。 |
| 複製與搬移 | 複製拒絕 FIFO；複製後核對來源 FD 的身分、大小、mtime 及 Darwin change time，偵測保留大小與 mtime 的改寫。目的檔被替換時保留外部檔案及其時間資訊，目的檔消失時保留唯一來源。 |
| ExFAT 檔案身分 | 新建空檔配置資料區塊後，檔案系統回報的 inode 可能改變。複製使用尚開啟 FD 的即時 metadata 核對路徑與回滾，Sync 後回傳最新身分；取消可清除半成品，同時保留被其他工作替換的目的檔。此項是檔案操作相容性修正，沒有加入編譯搬移或鏡像流程。 |
| 匯出完成與回滾 | 匯出取消時同樣以開啟 FD 的最新身分清除半成品；完成前 Sync 並核對目前目的地，遭替換時回報錯誤並保留替換檔，不再誤報成功。 |
| 音訊播放與資源 | 準備下一首期間收到暫停要求，延遲完成後不再自動續播。AudioContext 部分初始化失敗時斷開已建立節點並關閉 context；測試亦驗證正常重掛時重用 context，卸載清除 RAF、listener 及 context。 |
| 字幕 | 支援合法的分鐘格式及超過兩位小時的 WebVTT 時間，排除 NOTE／STYLE／REGION 與無效時間範圍。先移除真正標籤再解碼 entity，保留跳脫角括號文字。ASS／SUB／SAMI 與標籤清理避免未閉合標記造成反覆掃描；SAMI 完整消費 SYNC 標籤，避免殘留引號／大於符號及空白 cue。 |

本輪新增 **30 項 top-level 回歸測試**（Go 21、前端 9）：

- **Go 161 項測試通過，無跳過**，使用 Go 1.26.6、race detector；internal/app statement coverage **71.5%**。
- **前端 90 項測試通過，無跳過**；TypeScript／Vite production build 通過。
- Go vet、desktop／production 原生編譯、git diff --check、git fsck 通過；Mach-O 為 arm64，最低 macOS 版本仍為 **12.0**。
- 修正前版本重現生命週期取消、延遲下載、舊檔案 ID、FIFO 複製、來源改寫、目的檔替換及播放器問題。複製／匯出取消與下載備援提交另外在專案實際 ExFAT 檔案系統驗證。
- 異常 ASS 輸入含 30 萬個未閉合標記，修正前超過 5 秒遭測試子程序終止；修正後 ASS／SUB／SAMI／標籤清理的控制案例合計約 58 ms（包含 Node 啟動）。這是特定輸入的回歸驗證，不是原生 WebView 或整體 App 效能保證。

修改前保留 .bak，完成驗證後清除本輪備份、測試暫存與前端建置產物。既有 App／DMG 及模型檔案保留，未同步 GitHub。

驗證界限：前端使用真實元件搭配受控 hook／Wails bridge，尚未手動驗證原生 WebView 或實體音訊裝置；FFmpeg／ffprobe 使用受控替身，完整 Wails 發行封裝仍缺少 third_party/ffmpeg。檔案身分核對用於一般並行修改保護，並非完整檔案系統交易；取消也不保證立即中斷已在執行的同步解碼。

## 第四輪：一般檔案讀取、媒體資源與大型文件（2026-09-21）

| 範圍 | 原問題與修正 |
| --- | --- |
| 特殊檔案與 HTTP | 已登錄的圖片／PDF／影片被替換成 FIFO 時，os.Open 會阻塞，PDF／影片還可能占住媒體生命週期鎖。共用 openRegularFile 先檢查種類，Unix 使用 O_NONBLOCK，開啟後再檢查 FD；HTTP 對特殊檔案回 404，一般檔案符號連結仍可使用。ZIP／TAR 來源與一般內容讀取也採用此流程。 |
| 掃描與連結大小 | 掃描不再把 FIFO 或指向資料夾的檔案名稱連結列成圖片／文件；一般檔案連結使用目標大小，避免錯誤大小使重複內容偵測漏比對。 |
| 目錄快取 | 讀取拒絕非一般檔案及符號連結，核對開啟 FD 的身分及大小，讀取本身也限制 64 MiB，避免 Stat 後路徑替換或檔案成長繞過限制。ZIP／TAR 索引保存來源 FD 的 metadata。 |
| 讀取取消與匯出回滾 | contextReader 在底層回傳後再次檢查取消，避免最後資料與 EOF 同時返回時吞掉取消。匯出失敗／取消只刪除本次建立的檔案；若目的地已被其他工作替換則保留，並回報清理失敗。 |
| 圖片與媒體版本 | 圖片 URL／ETag、媒體轉檔來源指紋納入現有 Darwin change-time identity，避免同大小、保留 mtime 的修改仍收到 304、播放舊轉檔或保存過期改封裝。 |
| 媒體資源 | FFmpeg 診斷最多保留 64 KiB，持續排空其餘輸出；ffprobe JSON 超過 1 MiB 拒絕。原檔移走、刪除或變成資料夾後仍可釋放播放快取，刪除失敗保留索引供重試；改封裝提交失敗會清除 .part。 |
| CSV／TSV | 修正末尾空引號欄位遺失、剛好達列上限誤報截斷及超過欄上限漏報。最多配置 100 欄，長欄位改成整段切片；表格警告依篩選後結果判斷。 |
| JSON／工作區 | 限量預覽大型陣列時不再先建立全部索引鍵；圖庫縮小時同步縮小「全部載入」目標，停止無法達成的進度及多餘 RAF。 |

本輪新增 **24 項 top-level 回歸測試**（Go 18、前端 6）：

- **Go 140 項測試通過，無跳過**，Go 1.26.6、race detector；internal/app statement coverage **69.1%**。
- **前端 81 項測試通過，無跳過**；TypeScript／Vite production build 通過。
- Go vet、desktop／production 原生編譯、git diff --check、git fsck 通過；一般檔案 helper 單獨 Windows/amd64、Linux/amd64 交叉編譯通過。
- 使用修正前版本重現圖片 304／FIFO 阻塞、7 個媒體案例、5 個前端案例，以及連結大小、快取符號連結、EOF 取消與匯出回滾案例。修正後均通過。
- Node 單次控制量測：百萬項 JSON 陣列預覽額外 heap 約 **33.20 → 1.14 MiB**；百萬字元 CSV 單欄約 **31.58 → 1.12 MiB**，時間約 **28.5 → 4.6 ms**。這是特定輸入的 Node 量測，並非原生 WebView 或整體 App 效能保證。

大幅修改前建立 .bak，驗證後清除本輪備份、overlay、測試暫存及前端建置產物。保留既有 App／DMG，未變更模型、依賴版本或同步 GitHub。

驗證界限：FFmpeg／ffprobe 採受控替身，尚未驗證真實編碼品質；完整 Wails 發行封裝仍缺少 third_party/ffmpeg，原生 WebView 尚未手動驗證。Darwin 以外的來源版本仍使用原有檔案識別／大小／mtime；Windows helper 僅交叉編譯，未執行。

## 第三輪：下載、封存快取與主畫面生命週期（2026-09-21）

本輪繼續修正可重現問題，沒有同步 GitHub、變更模型位置或重新加入外接硬碟編譯搬移流程。

| 範圍 | 原問題與修正 |
| --- | --- |
| 圖庫掃描 | 停止後的快取／BeginOperation 回應不再啟動舊掃描；新掃描取消前次工作，ResetLibrary 依序完成。舊工作失敗不會清除新樹，卸載後的延遲 ID 亦會 Cancel／Finish。 |
| Finder／啟動還原 | ConsumeOpenFilePaths 串行消費，避免空回應使已取走的檔案遺失；直接開檔、延遲背景掃描及啟動快取皆檢查請求代次。已存在圖庫時跨目錄開檔、同目錄新增檔案可正常處理；手動改選目錄會終止前次 Finder 意圖。 |
| PDF／校驗碼／圖片預取 | PDF 切換會取消準備工作，包括延遲取得的 ID。SHA-256 先保留工作身分，避免連點重複執行；切檔後丟棄舊結果。圖片預取的操作配置／結束錯誤不再變成未處理 Promise 拒絕。 |
| 圖庫快取寫入 | 根路徑輸入框尚未掃描的新文字，不再搭配舊樹寫入快取或選取紀錄；讀取時也驗證樹本身的根路徑。 |
| 下載面板 | 同步保留提交身分，避免連點重複下載／HLS 確認。慢速輪詢合併、過期快照不覆蓋新狀態；卸載停止後續 URL 提交，保留提交期間新輸入的網址，承接取消及開目錄錯誤。 |
| 下載提交與檔名 | 最後一次讀取同時回傳資料與 EOF 時仍檢查取消。提交改用既有不可覆寫搬移，支援無 hard link 的檔案系統；成功提交後維持成功。長中文／emoji 名稱按 UTF-8 位元組截斷並保留副檔名與碰撞尾碼空間；工作結束釋放 cancel，歷史讀寫限制 8 MiB。超限寫入保留先前有效紀錄。 |
| HLS 分段完整性 | 驗證 Content-Range、回應長度、偏移與總長；拒絕未請求的 206、跨 URL 沿用隱含偏移及整數溢位，避免損壞分段拼接成成功下載。 |
| ZIP／TAR 快取 | 等待索引鎖可取消；macOS 納入 change time，避免原地修改、保留大小與 mtime 後仍沿用舊索引或舊展開內容。 |
| 縮圖與圖片視圖 | 重新掃描清除前端縮圖快取，舊排隊／執行結果不能回填；卡片在同一路徑的新代次重新載入，同時維持最多 3 個後端要求。圖片置中 RAF 合併及清理，切圖時釋放舊 pointer capture。 |

本輪驗收：

- **Go 122 項 top-level 測試通過，無跳過**；新增 11 項，使用 Go 1.26.6、race detector，internal/app statement coverage **67.6%**。
- **前端 75 項測試通過，無跳過**；新增 29 項，包括 16 項真實 App handler／effect 回歸案例與 13 項下載、圖片及縮圖生命週期案例。
- 修正前 App 備份通過相同測試載入器執行 4 個掃描情境，全部重現失敗；修正後全部通過。ZIP／TAR 鎖取消與保留 mtime 的舊內容問題亦以修正前版本重現。
- TypeScript／Vite production build、Go vet、desktop／production 原生編譯、git diff --check 及 git fsck 均通過。下載備援提交包含實際專案檔案系統驗證。
- 大幅修改前保留 .bak；驗證後清除本輪備份、暫存測試及前端建置產物，既有 App／DMG 保留。模型檔案未更動。

驗證界限：前端採真實元件及受控 hook／Wails bridge 測試，尚未以原生 WebView 手動操作；完整 Wails 發行封裝仍缺少 third_party/ffmpeg。非 Darwin 的封存快取沿用檔案識別、大小及 mtime 檢查。

## 第二輪：並行、取消與檔案一致性（2026-09-21）

在上一輪修正後，繼續檢查實際可重現的邊界情況，完成以下修正：

| 範圍 | 原問題與修正 |
| --- | --- |
| 工作區操作 | 等待 BeginOperation 時可重複啟動，取消／卸載亦可能遺漏尚未取得的操作 ID。現在先保留操作身分；延遲取得 ID 仍會 Cancel／Finish，取消後不執行尚未開始的搬移，也不套用過期結果。 |
| 重複偵測與音訊切換 | 圖庫／篩選變動後的舊重複群組不再回填。音訊相容轉換以播放工作階段判斷有效性，切換後舊結果不再取代新 URL；Begin／Finish 的 Promise 錯誤已處理。 |
| 媒體快取生命週期 | 準備、保存、釋放使用同一項目鎖且等待可取消；清理先取消 FFmpeg／複製、等工作退出再刪暫存。公共 Prepare 的登錄亦受生命週期保護，ResetLibrary 先清理工作再清除登錄。 |
| 影音／PDF 串流 | 取得快取路徑至開啟檔案之間保持項目鎖，取得 FD 後立即釋鎖；釋放快取後已開啟串流仍可完成。一般音訊與相容轉換使用不同的解壓中間檔，避免互相刪除。 |
| 保存改封裝 | 保存前及複製完成後重新檢查來源指紋，拒絕以舊轉檔結果取代已修改原檔。保存與垃圾桶搬移均可取消；搬移完成後視為成功，避免取消反而刪除成功結果。 |
| 跨磁碟檔案操作 | 備援複製保留符號連結、權限與修改時間，不再把私密檔案固定建立為 0644。搬移後的懸空連結正確回報成功；回滾會確認目的檔身分，來源變動時保留來源及複本。這不是抵禦所有惡意競態的檔案系統交易。 |
| 縮圖快取 | 快取鍵納入來源檔案大小；macOS 另納入 inode／change time，避免同路徑、同大小、同修改時間的替換沿用舊縮圖。生成後重新核對來源版本才寫入；同一 FD 的讀取有位元組上限，拒絕快取符號連結，外部刪除會同步移除容量索引。 |
| FFmpeg 建置前檢查 | 不再吞掉 -version 失敗；工具無法執行、工具名稱不符或缺少組態資訊均中止。保留 GPL／nonfree 拒絕規則，避免錯誤工具通過檢查後才影響 App 建置。 |

本輪驗收：

- **Go 111 項 top-level 測試全部通過**，無跳過，使用 Go 1.26.6、race detector；internal/app statement coverage **65.5%**。本輪新增 26 項。
- **前端 46 項測試通過**，本輪新增 7 項生命週期及 5 項 FFmpeg 檢查測試；TypeScript／Vite production build 通過。
- Go vet、production／desktop 原生編譯、shell 語法、git diff --check 與 git fsck 通過。
- 檔案測試包含真正的 專案磁碟 與系統暫存磁碟間搬移。媒體取消、清理及保存以受控 FFmpeg／probe 替身測試，不代表已驗證真實編碼品質。
- 新的縮圖 identity helper 已個別交叉編譯至 Windows/amd64 與 Darwin/amd64；完整 App 跨平台未驗證。非 Darwin 仍以大小／修改時間作為縮圖來源檢查。
- 本輪未更動套件版本，未同步 GitHub。驗證用的 .bak、測試暫存與前端建置產物已清理，既有 App／DMG 保留。

完整 Wails 發行封裝及原生 WebView 操作驗證仍待補齊 FFmpeg 發行目錄；前輪列出的 ExFAT 環境限制仍適用。

## 修正與驗收（同日後續）

F01–F12 已完成程式修正；E01 已在備份後清理並通過 Git 完整性檢查。下方保留的是**修正前的檢查紀錄**，其中的「目前」「本次未修改」及失敗結果均指最初檢查階段。

| 項目 | 修正結果 |
| --- | --- |
| F01 | Go 最低版本 1.26.6、x/image 0.45.0；更新 x/sys、x/text 與 nanoid／postcss 鎖檔，重建授權清冊。 |
| F02 | npm build 移至 Go vet／test／授權分析之前；缺少 FFmpeg 時在 Wails 取代既有 App 前停止。 |
| F03 | macOS 原子 RENAME_EXCL；不支援或跨磁碟時使用獨占建立、完成複製與 Sync 後才刪除來源。垃圾桶亦拒絕覆寫。 |
| F04 | 本機與封存 HEIC 使用相同瀏覽器解碼例外，保留 128 MiB 讀取上限；不是新增 Go HEIC 解碼器。 |
| F05 | 匯出命名限制長度與嘗試次數，檢查取消，非衝突錯誤直接回傳。 |
| F06 | JSON 迭代遍歷，上限 10,000 節點／64 層；收合分支延後渲染，ErrorBoundary 提供有長度限制的原始文字備援。 |
| F07 | MoveResult.originalIds 明確識別原項目，更新來源／目的資料夾，顯示部分失敗原因。 |
| F08 | 前端 finally 統一 FinishOperation；後端匯出提前返回亦清理操作。目的地選擇錯誤納入同一錯誤流程。 |
| F09 | 縮圖磁碟 LRU 每次寫入維持 1,200 筆及 256 MiB，只在初始化掃描目錄。 |
| F10 | 媒體快取檢查來源檔案識別、大小與修改時間；準備期間若來源變動拒絕儲存。保留已開啟串流及已保存改封裝檔案。 |
| F11 | HLS variant 使用重新導向後 URL 解析相對片段；既有公共位址檢查不變。 |
| F12 | 字幕 await 回來先確認 effect 仍有效，過期回應不更新狀態或建立 Blob URL。 |
| E01 | 備份 .git 後，僅移除檔頭確認為 AppleDouble 的 655 個旁置檔；git fsck 通過。 |

另在原生編譯驗證發現本機預設工具鏈已為 Go 1.27.1，產生的物件要求 macOS 13。build.sh／run.sh 現在依 go.mod 選用 Go 1.26.6，維持既有 macOS 12 目標；未變更使用者的全域 Go 設定。

驗收包含：

- Go 85 項測試，含新增 10 項回歸測試與 race detector；statement coverage 63.0%。
- 前端 34 項測試，含深層 JSON 的真實 React renderer，以及真實 hook／字幕 effect 搭配受控 bridge 的生命週期測試。
- 移除 frontend/dist 後，執行 build.sh 原有檢查區段：npm ci、production build、go mod verify、go vet、go test -race、前端測試、npm audit 及授權清冊產生均通過。
- Go 1.26.6 的 production／desktop 原生編譯通過；Mach-O 檢查確認 arm64、minos 12.0。直接 go build 驗證使用 Wails CLI 同樣會加入的 UniformTypeIdentifiers framework。
- govulncheck v1.8.0 無已知可達弱點；npm audit（含開發依賴）0 項。
- 目前 專案磁碟 檔案系統上的改名／移動及衝突測試通過，包含不支援 RENAME_EXCL 時的備援路徑。
- shell 語法、git diff --check、git fsck 通過。

限制：尚未完成 Wails App 的完整封裝、簽章與原生 WebView 操作驗證，因第三方 FFmpeg 發行目錄仍缺少；保留既有 App／DMG。專案磁碟 仍為 ExFAT，AppleDouble 有再次產生的可能。直接將 Go 測試執行檔放在此磁碟曾出現 exec format error，因此磁碟行為測試將執行檔放在系統暫存區、資料檔放在 專案磁碟；這只用於本次驗證，未加入專案建置搬移或鏡像流程。

本次未同步 GitHub。

## 原始檢查紀錄

本次確認 12 項程式／流程問題（3 項 P1、8 項 P2、1 項 P3），另有 1 項 Git 工作環境問題。P1 建議優先修正；P2 為特定輸入或操作下的功能／資源問題；P3 為較低急迫性的資源管理問題。

檢查對象是目前本機未提交的完整工作目錄，包含前次效能調整，並非只檢查 GitHub 上的版本。檢查範圍包含檔案操作、圖片與文件讀取、HTTP 端點、ZIP／TAR 快取、下載器、前端非同步生命週期、建置及依賴。既有程式碼未修改，未執行 GitHub 同步。重現使用自建測試檔，沒有改動使用者的媒體或文件。

## 檢查環境與結果

檢查時使用目前專案目錄，先前的專案位置已不存在。本機磁碟資訊顯示專案位於 USB／ExFAT；這是檢查時的實際狀態。

| 檢查 | 結果 |
| --- | --- |
| 前端既有測試 | 29 項通過 |
| TypeScript／Vite production build | 通過 |
| Go 套件測試 | 75 項通過，啟用 race detector |
| Go 套件 statement coverage | 60.9% |
| Go main package 測試編譯 | 通過，main package 無測試 |
| go mod verify、go vet ./... | 通過；vet 執行時前端資產已建好 |
| zsh 語法檢查 | build、run、clean、DMG 與 FFmpeg 腳本通過 |
| 全新／清理後的建置前置檢查 | 失敗，見 F02 |
| govulncheck v1.8.0 | 6 項 symbol 可達的已知弱點，見 F01 |
| npm audit --omit=dev | 0 項 |
| npm audit（包含開發依賴） | 2 個 high 套件：nanoid、postcss |
| git fsck --full --no-reflogs | 原目錄失敗；排除 AppleDouble 的獨立副本通過，見 E01 |

本次未完成原生 Wails App 封裝及 macOS WebView 操作測試。專案仍缺少 `third_party/ffmpeg/bin`，因此不能據此宣稱發行包已驗證。前端非同步重現使用真實模組搭配受控 hook／bridge 模擬；JSON 使用實際 React server renderer。它們不等同於原生 WebView 的記憶體或互動測試。

## F01 · P1 · 圖片解碼與 Go 工具鏈仍含已知弱點

位置：[go.mod](../go.mod#L3)、[thumbnail_decode.go](../internal/app/thumbnail_decode.go#L85)。

目前使用 Go 1.26.4 與 `golang.org/x/image v0.44.0`。govulncheck 指出縮圖的 `image.Decode → vp8l.Decode` 可達 GO-2026-6222：特製 WebP 的 Huffman tree groups 可造成過量配置。像素數預算無法限制這種解碼器內部資料結構，因此現有 5,000 萬像素限制不能取代依賴修補。官方列出的修正版本為 x/image v0.45.0。[官方弱點資料](https://pkg.go.dev/vuln/GO-2026-6222)

另外 5 項工具鏈 symbol 命中如下。這是靜態呼叫圖結果，並不代表每一項攻擊條件都在此 App 成立；例如 ECH 問題仍取決於 TLS 設定。

| 弱點 | 掃描涉及範圍 | Go 1.26 分支修正版 |
| --- | --- | --- |
| [GO-2026-6218](https://pkg.go.dev/vuln/GO-2026-6218) | net/url，相對路徑解析的平方時間複雜度 | 1.26.6 |
| [GO-2026-6090](https://pkg.go.dev/vuln/GO-2026-6090) | crypto/tls，handshake 訊息處理 | 1.26.6 |
| [GO-2026-5972](https://pkg.go.dev/vuln/GO-2026-5972) | encoding/asn1，遞迴深度 | 1.26.6 |
| [GO-2026-5856](https://pkg.go.dev/vuln/GO-2026-5856) | crypto/tls，ECH 隱私問題 | 1.26.5 |
| [GO-2026-5026](https://pkg.go.dev/vuln/GO-2026-5026) | 標準庫 net/http 的 IDNA 處理 | 1.26.6 |

建議至少將 x/image 更新至 v0.45.0、Go 工具鏈及最低版本更新至 1.26.6，再重跑掃描與影像／下載測試。nanoid、postcss 的 npm 警示只出現在開發依賴，不應解讀為已打包前端有兩個可直接利用的弱點，但建置依賴仍應更新。

## F02 · P1 · 清理後無法直接執行建置

位置：[build.sh](../build.sh#L150)、[main.go](../main.go#L18)。

`go vet ./...`、`go test -race ./...` 和授權清冊的 `go list` 都早於 `npm run build`；main.go 卻要求嵌入 `all:frontend/dist`。清理或全新取出原始碼後，該目錄不存在，腳本會在建立前端資產前中止。

在獨立的原始碼副本省略 frontend/dist，執行 go vet，實際得到：

```text
main.go:18:12: pattern all:frontend/dist: no matching files found
exit 1
```

建議把前端建置移到所有需要解析 main package 的步驟之前，並增加「從沒有 frontend/dist 的狀態執行建置」驗證。先手動 npm build 再測 build.sh，會掩蓋此問題。

## F03 · P1 · 改名及移動的「不覆寫」保護不是原子操作

位置：[fileops.go](../internal/app/fileops.go#L47)，移動同樣使用第 150–157 行的流程。

先 os.Stat 確認目標不存在，再 os.Rename；另一個程式或操作可在中間建立目標檔，接著 rename 會直接覆寫。這與介面宣稱的「同名拒絕」不一致。

重現時，使用既有的 renameFile 注入點，在存在性檢查後建立含有 other document 的目標，再呼叫真實 os.Rename。結果沒有回報錯誤，目標內容變成 source data。這是受控競態重現，沒有覆寫使用者檔案。

建議使用作業系統提供的原子不覆寫 rename，或具獨占建立與可靠回滾的搬移流程；不得只追加另一次 Stat。

## F04 · P2 · 新的 HTTP 圖片路徑拒絕本機 HEIC

位置：[image_http.go](../internal/app/image_http.go#L61)。

舊的 validateImageData 允許 HEIC 交給 WebKit 解碼；新的 validateImageReader 只略過 SVG，HEIC 進入沒有註冊 HEIC 解碼器的 Go image.DecodeConfig，必定回報 unknown format。

用 macOS sips 將專案測試 PNG 轉成 HEIC 後，舊驗證通過，LoadImageByPath 失敗，HTTP 端點回傳 422：

```text
無法讀取 sample.heic: image: unknown format
```

建議統一本機檔案與壓縮檔的格式政策。若保留 WebKit HEIC 支援，應使用可理解 HEIC 的標頭檢查／原生路徑，或明確維持原有格式例外及大小限制，並補上本機與封存 HEIC 測試。

## F05 · P2 · 超長匯出檔名造成無限迴圈，取消也無效

位置：[app.go](../internal/app/app.go#L1355)。

uniqueExportName 只在 Stat 回傳「不存在」時退出，其他錯誤一律繼續嘗試更長的名稱。ZIP／TAR 可包含超過目標檔案系統單一名稱限制的項目；此時所有嘗試都回傳 ENAMETOOLONG。函式也沒有接收取消 context。

以 300 個 a 加上 .txt 的名稱呼叫真實函式，測試超時 1 秒後被強制結束，堆疊停留在 uniqueExportName → os.Stat。目的地存取遭拒時也有相同的控制流程問題。

建議讓此函式回傳 error，遇到非存在性衝突立即停止，限制檔名字節數，並在迴圈檢查取消。

## F06 · P2 · 小型但深層的 JSON 可使預覽拋出未處理錯誤

位置：[structuredViewers.tsx](../frontend/src/structuredViewers.tsx#L71)。

countJsonNodes 以遞迴走訪全部深度，且先遞迴再檢查剩餘預算。1 萬節點限制不是遞迴深度限制；JsonNode 也會建立收合分支的子節點。

實際 React renderer 載入 8,000 層陣列、僅 16,001 bytes 的有效 JSON，拋出 RangeError: Maximum call stack size exceeded；3 層對照組正常。現有 App 沒有 ErrorBoundary，這類渲染錯誤可能讓整個 UI 消失。原生 WebView 的確切深度門檻未量測。

建議計數改用顯式堆疊，加入合理深度與節點上限，收合分支延後建立，並在文件預覽外層加入錯誤隔離與原始文字備援。

## F07 · P2 · 批次移動以檔名配對來源，可能更新錯誤項目

位置：[useWorkspace.ts](../frontend/src/useWorkspace.ts#L211)。

移動完成後，用 selectedImages.find(image.name === moved.name) 尋找原項目。不同來源可以同名，且後端允許部分成功。例如先選封存內 same.txt，再選一般資料夾中的 same.txt：前者不能移動，後者成功，前端卻把成功結果套到封存項目。

用真實 hook 與受控 bridge 模擬此合法回應，預期更新 source，實際更新 existing（封存項目）。此外 result.failed 沒有顯示給使用者。

建議 MoveResult 回傳每項成功結果的原始 ID／路徑，以明確識別配對，正確調整來源與目的節點，並顯示部分失敗原因。

## F08 · P3 · 工作區操作完成後未釋放 operation

位置：[useWorkspace.ts](../frontend/src/useWorkspace.ts#L158)、[registry.go](../internal/app/registry.go#L58)。

runOperation 每次 BeginOperation，但 finally 只清掉前端 ref，不呼叫 FinishOperation。移動與垃圾桶方法不接收 operation ID，因此後端無從結束它。匯出取消選擇目錄時，也會在後端註冊 defer FinishOperation 前返回。

真實 hook 的一次移動重現結果為 BeginOperation = 1、FinishOperation = 0。操作 context／cancel 與 registry 項目會在同一個 App 工作階段持續累積。

建議在統一 finally 釋放該次 operation ID，所有提前返回、取消及錯誤路徑都納入驗證；不支援取消的短操作也可避免建立 ID。

## F09 · P2 · 縮圖磁碟快取的 1,200 筆上限沒有持續執行

位置：[app.go](../internal/app/app.go#L398)。

pruneCacheFiles 被 sync.Once 包住，只在第一次縮圖請求之前執行；每次寫入新縮圖後都不再清理。因此長時間瀏覽持續增加磁碟檔案，即使每張縮圖和前端記憶體都有個別限制。

預先放入 1,200 個快取檔後載入一張新縮圖，實際變成 1,201 個；後續寫入同樣不受此限制。

建議以寫入批次或週期維護數量及總字節預算，避免每張都全目錄排序，也避免只在 App 啟動時清理。

## F10 · P2 · 媒體快取未檢查來源版本，會播放舊內容

位置：[media.go](../internal/app/media.go#L388)。

媒體快取只用路徑衍生的 ID，命中時只檢查暫存檔是否存在；沒有驗證來源的大小、修改時間或檔案識別。圖片 ZIP／TAR 索引已有失效機制，媒體解壓／轉檔快取則沒有。

重現：準備 ZIP 中 movie.mp4 → 將同一 ZIP 換成新內容 → 再次 PrepareMediaByPath → 串流仍以 HTTP 200 回傳 old movie。需要清空圖庫、釋放快取或重啟才會更新。相同路徑的改封裝來源也受同類邏輯影響。

建議快取保存來源指紋，包含封存來源及內部項目；命中前驗證，失效時妥善處理正在播放的讀取器。

## F11 · P2 · HLS 子播放清單重新導向後仍用舊 URL 解析片段

位置：[download.go](../internal/app/download.go#L505)。

fetchDownloadMetadata 只回傳 body，丟失最終 response.Request.URL。downloadHLS 將子清單內容相對於重新導向前的 playlistURL 解析。

本機測試伺服器的 variant.m3u8 重新導向至 /cdn/playlist.m3u8，內含 segment.ts；實際卻請求 /segment.ts，而不是 /cdn/segment.ts，下載以 404 失敗。初始清單的重新導向有處理，問題發生在後續 variant 的下載。

建議 metadata helper 一併回傳最終 URL，下一層解析改用該 URL，並保留既有公共位址與重新導向安全檢查。

## F12 · P2 · 字幕載入在切換後仍更新舊內容並漏釋放 Blob URL

位置：[MediaPlayer.tsx](../frontend/src/MediaPlayer.tsx#L447)。

effect 只在 await 前檢查 cancelled。切換影片或修改字幕設定時，cleanup 可能先執行，當時 objectURL 尚未建立；舊的讀檔完成後仍會建立 Blob URL 並呼叫 setSubtitleCues／setSubtitleURL。

用真實 effect 與延後完成的字幕讀取重現，cleanup 後仍有 2 次狀態更新、建立 1 個 Blob URL、撤銷 0 個。舊字幕可能蓋掉新字幕，未撤銷的內容也會留在 WebView 記憶體。

建議每次 await 完成後立即檢查取消／請求世代，取消時不建立 Blob、不更新狀態，並確保每個建立的 URL 都有對應撤銷。

## E01 · 工作環境 · AppleDouble 中繼檔被 Git 當成索引與 refs

位置：本機 Git 物件資料庫（不隨原始碼發佈）。

工作目錄中的 .git/objects/pack 存在 `._pack-*.idx`，refs 中也有 `._main`、`._base` 等檔案。git status／diff 出現 non-monotonic index；完整 fsck 退出碼為 76，包含 badRefName／badRefContent。

另外複製 .git 到本機暫存區，僅排除 `._*` 和 .DS_Store，不修改來源；副本的完整 fsck 退出碼為 0。這支持「中繼檔干擾 Git」，目前沒有證據需要重建提交歷史或丟棄未提交修改。

建議先完整備份 .git，再處理經檔頭確認的 AppleDouble 檔。長期應讓 Git 工作目錄位於不會產生此類旁置檔干擾的檔案系統；模型與使用者媒體仍可獨立保留在外部磁碟。本次只做檢查，未清理或改寫原 .git。

## 建議修正順序與驗收

1. 優先更新影像解碼依賴與 Go 工具鏈、修正清理後建置順序，以及檔案異動的原子不覆寫保護。
2. 修正 HEIC、匯出迴圈與 JSON 深度處理，讓不支援或異常輸入可取消、可顯示錯誤。
3. 修正批次移動對應、operation 釋放、字幕非同步清理及快取失效／容量維護。
4. 修正 HLS 重新導向基準 URL，更新開發依賴，並處理 Git 中繼檔。
5. 修正後將以上重現案例轉成正式回歸測試；補齊 FFmpeg 後驗證全新建置、完整 App 簽章，以及原生 WebView 的快速切檔／字幕切換／長時間瀏覽。

本次新增的暫時重現測試已移除，避免將已知會失敗的檢查混入既有測試套件。檢查前後以 SHA-256 驗證原有原始碼及依賴鎖檔內容一致；本次唯一保留的專案檔案新增為這份報告。
