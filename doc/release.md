# GitHub Release Guide

## 版本與文件

目前 App 版本為 `1.26.1003`，最新發行修訂為 `v1.26.1003-r2`。同日修訂使用獨立 tag 與附件名稱，保留原有版本；App 的數字版本不變，build number 必須增加。發布前確認 `wails.json` 的 `info.productVersion`，更新 `CHANGELOG.md`、三語 README 與對應的 `doc/release-v<revision>.md`。效能數據需連結基準方法及量測限制，不可視為整體 App 的等比例提升。

專案授權以 `LICENSE.md` 及其翻譯為準。文件、About、npm package metadata、App 內的 `build-metadata.json` 與授權文字應一致；第三方元件保留各自條款。

## 建置與檢查

Apple Silicon Mac 需具備 Go 1.26.6、Node.js／npm、Xcode Command Line Tools、CMake 與 `pkg-config`。

```bash
./scripts/build-codec-deps-macos.sh
./scripts/build-ffmpeg-macos.sh
APP_MARKETING_VERSION=1.26.1003 BUILD_TAG=v1.26.1003-r2 ./build.sh
```

第一個腳本以固定來源與 SHA-256 建立 macOS 12 的 Opus／libvpx；FFmpeg 腳本優先使用 `third_party/codecs`。App 建置驗證所有影音工具與動態函式庫的最低系統版本，避免本機套件升級改變支援範圍。

`build.sh` 執行依賴驗證、Go vet、race tests、前端測試、TypeScript／Vite build 及 npm production audit，並產生第三方通知及完整授權文字。若通知檔有變更，先納入版本提交。

確認 `Contents/Resources/Licenses` 包含專案與第三方授權，`build-metadata.json` 記錄正確版本、commit、tag、來源 URL 與工作樹狀態。公開原始碼及 App 均需通過 `scripts/check-privacy.mjs`。建置產物、本機設定及 `.bak` 不提交到 Git。

## 標記與正式安裝包

來源及文件驗證完成、工作樹乾淨後，建立單一版本 tag：

```bash
git tag -a v1.26.1003-r2 -m "FastFileViewer v1.26.1003-r2"
```

從該 tag 重新建置正式 App，指定本機可用的 Developer ID Application 身分；簽章憑證與公證設定只保存在本機。公開 DMG 須完成 App 與 DMG 的簽章、Apple 公證、票據釘選及 Gatekeeper 驗證。解開 DMG 後再次確認 App 版本、來源 commit、內建 FFmpeg／ffprobe、授權及最低 macOS 版本。

正式檔名為 `FastFileViewer-1.26.1003-r2-arm64.dmg`，附同名 `.sha256`。修訂版先輸出至獨立暫存目錄，完成驗證後再使用修訂版檔名保存，避免覆寫舊附件；checksum 內也使用最終檔名。相依套件來源包提供與安裝包相符的 FFmpeg、Opus、libvpx 原始碼及重建說明。

## 上傳與發布

```bash
git push origin main
git push origin v1.26.1003-r2
gh release create v1.26.1003-r2 --verify-tag --draft \
  --title "FastFileViewer v1.26.1003-r2" \
  --notes-file doc/release-v1.26.1003-r2.md
gh release upload v1.26.1003-r2 \
  dist/FastFileViewer-1.26.1003-r2-arm64.dmg \
  dist/FastFileViewer-1.26.1003-r2-arm64.dmg.sha256 \
  dist/FastFileViewer-1.26.1003-r2-codec-sources.tar.gz \
  dist/FastFileViewer-1.26.1003-r2-codec-sources.tar.gz.sha256
gh release edit v1.26.1003-r2 --draft=false --latest
```

發布後核對遠端 main、tag、Release 指向相同 commit，確認附件名稱、大小與下載後的 SHA-256。Release Notes 說明使用者可感受到的改善、相容性及下載方式。
