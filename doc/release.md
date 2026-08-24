# GitHub Release Guide

## 公開原則

GitHub 公開來源只包含可重現建置所需的原始碼、通用腳本、圖示及授權文件，不包含本機發布憑證或個人化設定。

## 發布前檢查

- [ ] `LICENSE` 為 GPLv3，README 與 `COMMERCIAL-LICENSE.md` 的雙軌授權說明一致。
- [ ] `THIRD-PARTY-NOTICES.md` 已重新產生。
- [ ] `.env*`、`build/bin/`、`dist/`、`frontend/dist/`、安裝包與本機發布資產未加入 Git。
- [ ] 原始碼不存在發布憑證、密碼、Token 或個人絕對路徑。
- [ ] `go.mod` module 為 `github.com/VaderChen/FastFileViewer`。
- [ ] production Bundle ID 預設為 `com.vader.fastfileviewer`。
- [ ] `./build.sh` 完整通過。
- [ ] App 內含 GPLv3、第三方授權與 `build-metadata.json`。
- [ ] About 顯示版本、Git tag/commit/build state、GPLv3 與來源 URL。
- [ ] App 與 DMG 均使用 Developer ID Application 簽署並啟用 Hardened Runtime。
- [ ] App 與 DMG 均通過 Apple Notary Service、完成 staple，且 Gatekeeper 驗證成功。

## 建立版本

```bash
git tag -a v1.26.0824 -m "FastFileViewer v1.26.0824"
git push origin main --tags
```

建議讓 tag 指向乾淨工作樹，再執行：

```bash
APP_MARKETING_VERSION=1.26.0824 ./build.sh
```

建立 DMG 前必須使用 Developer ID Application 重新簽署 App，接著依序送交 App 與 DMG 至 Apple Notary Service，完成 staple 後使用 `spctl` 驗證。Release 只上傳已公證的 `FastFileViewer-<version>-arm64.dmg` 與同名 `.sha256`；本機打包腳本、Keychain Profile、憑證及其他發布設定不得提交到公開 Repository。

## Release Notes 建議

- 說明主要使用情境與新增功能。
- 列出支援的最低 macOS 與 CPU 架構。
- 連結對應 tag、GPLv3、第三方通知與安全政策。
- 列出下載檔名與 SHA-256 校驗檔。
- 清楚標示 DMG 已完成 Developer ID 簽署與 Apple 公證。
