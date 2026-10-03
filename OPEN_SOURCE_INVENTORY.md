# 公開內容盤點

本文件記錄首次公開及後續維護時納入與排除的內容範圍。

## 公開內容

- Go、React、TypeScript 與 Wails 原始碼。
- 圖片、文件、程式碼、壓縮檔瀏覽、內容工作區、安全 URL 下載、影片頁 `.m3u8` 解析／複選及公開未加密 HLS VOD 合併功能。
- 發布 App 會將依 `scripts/build-ffmpeg-macos.sh` 建立的 LGPL FFmpeg/ffprobe 動態版本放入 App Bundle；開發模式若沒有 Bundle 才回退使用系統 FFmpeg。Repository 不包含預建 FFmpeg 二進位檔。
- macOS Apple Silicon 開發與可重現 App 建置腳本。
- App icon、專案授權全文、授權政策、安全政策及開發文件。
- 第三方相依套件清冊產生工具。

## 不公開

- 所有本機發布資產與個人化說明。
- App Store、TestFlight、PKG、商店審查流程與所有本機發布設定。
- `build/bin/`、`dist/`、`frontend/dist/`、`frontend/node_modules/` 與所有安裝包。
- `.env*`、本機資料、個人文件、快取、除錯紀錄及未遮蔽路徑。
- `.codex-tmp/`、`.bak`、AppleDouble 與本機備份。

## 發布維護檢查

- 專案授權以 `LICENSE.md` 為準，第三方元件各自條款保持完整。
- Contributor License Agreement 完成前，不合併外部程式碼 Pull Request。
- 每次發布前重新掃描 Token、個人路徑與大型二進位檔。
- `LICENSE*.md`、`THIRD-PARTY-NOTICES.md` 與建置產物內完整授權文字保持同步。
- Repository 名稱與 module path 使用 `FastFileViewer`／`github.com/VaderChen/FastFileViewer`。
- 公開建置預設 Bundle ID 為 `com.vader.fastfileviewer`，不啟用 App Sandbox。
- URL 下載安全政策、大小限制與網路邊界須與 `README*`、`SECURITY.md` 及 `doc/developer.md` 保持一致。
