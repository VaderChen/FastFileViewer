# 開源內容盤點

本文件記錄首次公開及後續維護時納入與排除的內容範圍。

## 預計公開

- Go、React、TypeScript 與 Wails 原始碼。
- 圖片、文件、程式碼、壓縮檔瀏覽、內容工作區、安全 URL 下載、影片頁 `.m3u8` 解析／複選及公開未加密 HLS VOD 合併功能。
- 選用本機 `ffmpeg` 的 MKV 暫存 MP4 與非原生音訊暫存 M4A 相容播放整合；Repository 不包含或散布 `ffmpeg` 二進位檔。
- macOS Apple Silicon 開發與可重現 App 建置腳本。
- App icon、GPLv3、商業授權說明、安全政策及開發文件。
- 第三方相依套件清冊產生工具。

## 不公開

- 所有本機發布資產、憑證與個人化說明。
- App Store、TestFlight、PKG、商店審查流程與所有本機發布設定。
- `build/bin/`、`dist/`、`frontend/dist/`、`frontend/node_modules/` 與所有安裝包。
- `.env*`、本機資料、個人文件、快取、除錯紀錄及未遮蔽路徑。
- `.codex-tmp/`、`.bak`、AppleDouble 與本機備份。

## 發布維護檢查

- GPLv3＋商業授權維持雙軌條款。
- Contributor License Agreement 完成前，不合併外部程式碼 Pull Request。
- 每次發布前重新掃描 Token、本機發布憑證、個人路徑與大型二進位檔。
- `LICENSE`、`THIRD-PARTY-NOTICES.md` 與建置產物內完整授權文字保持同步。
- Repository 名稱與 module path 使用 `FastFileViewer`／`github.com/VaderChen/FastFileViewer`。
- 公開建置預設 Bundle ID 為 `com.vader.fastfileviewer`，不啟用 App Sandbox。
- URL 下載安全政策、大小限制與網路邊界須與 `README*`、`SECURITY.md` 及 `doc/developer.md` 保持一致。
