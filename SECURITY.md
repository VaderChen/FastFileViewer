# 安全性政策

## 回報方式

公開儲存庫建立後，請優先使用 GitHub 的 Private vulnerability reporting 回報安全問題。若該功能尚未啟用，請先透過 [VaderChen GitHub 個人頁面](https://github.com/VaderChen) 聯絡維護者，不要建立公開 Issue。

## 回報內容

- 受影響版本與 macOS 版本。
- 可重現步驟與預期影響。
- 已遮蔽個人檔案內容、使用者名稱與路徑的必要紀錄。
- 若涉及特製檔案，請先說明格式、大小及最小化重現方式，不要公開上傳含私人內容的原始檔。

請勿附上本機發布憑證、Token 或可識別個人的文件與目錄資訊。

## 下載器安全界線

- 下載只會在使用者明確貼上或拖入公開 `http://`／`https://` 網址後開始。
- 每次連線與重新導向都會重新解析並拒絕 loopback、localhost、私有 IP、link-local、multicast、unspecified 及保留測試網段，以降低 SSRF 與 DNS rebinding 風險。
- 下載不攜帶瀏覽器 Cookie、登入狀態、自訂 Authorization 或其他帳號認證。
- 不支援 DRM、付費牆、加密 HLS、受保護串流或未結束的 live HLS；`.m3u8` 僅處理公開、未加密且含 `EXT-X-ENDLIST` 的 VOD。
- 網頁解析器不執行頁面 JavaScript、不讀取瀏覽器狀態，只掃描最多 32 MB 的 HTML 與 inline script，最多回傳 16 個 HTTP/HTTPS `.m3u8` 候選。
- 不繞過 Cookie、登入、Cloudflare／反機器人驗證或其他網站存取控制；遇到 401／403 時要求使用者提供可直接存取的 `.m3u8`。
- 解析出的每個 `.m3u8` 仍經相同的 DNS、IP 與 redirect 驗證；來源標頭只包含已移除 query、fragment 與 credentials 的 Referer／Origin。
- 單一下載上限 4 GB；文字、HTML 與播放清單上限 32 MB；HLS 最多 20,000 個片段。
- 暫存檔與最終檔位於同一磁碟，完成時以不覆寫既有檔案的方式提交至 `~/Downloads/FastFileViewer`。
- 下載紀錄保存在 `os.UserConfigDir()/FastFileViewer/downloads.json`，網址查詢參數與 fragment 不會寫入紀錄，也不包含 Cookie 或認證資料。
- MKV 與音訊相容轉換只透過固定參數呼叫本機 `ffmpeg`，不使用 shell 展開；暫存媒體在 App 關閉時清除。

發現 URL 驗證繞過、內網存取、重新導向繞過、路徑穿越、任意檔案覆寫或下載上限繞過時，請依上述私密管道回報。
