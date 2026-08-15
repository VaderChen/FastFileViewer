# GitHub Release Guide

## 公開原則

GitHub 公開來源只包含可重現建置所需的原始碼、通用腳本、圖示及授權文件，不包含 Apple 簽章與商店發布資產。

## 發布前檢查

- [ ] `LICENSE` 為 GPLv3，README 與 `COMMERCIAL-LICENSE.md` 的雙軌授權說明一致。
- [ ] `THIRD-PARTY-NOTICES.md` 已重新產生。
- [ ] `cert/`、`.env*`、`build/bin/`、`dist/`、`frontend/dist/`、安裝包與私鑰未加入 Git。
- [ ] 原始碼不存在 Team ID、Provisioning Profile、憑證名稱、密碼、Token 或個人絕對路徑。
- [ ] `go.mod` module 為 `github.com/VaderChen/FastFileViewer`。
- [ ] production Bundle ID 預設為 `com.vader.fastfileviewer`。
- [ ] `./build.sh` 完整通過。
- [ ] App 簽章可由 `codesign --verify --deep --strict build/bin/FastFileViewer.app` 驗證。
- [ ] App 內含 GPLv3、第三方授權與 `build-metadata.json`。
- [ ] About 顯示版本、Git tag/commit/build state、GPLv3 與來源 URL。

## 建立版本

```bash
git tag -a v1.26.0815 -m "FastFileViewer v1.26.0815"
git push origin main --tags
```

建議讓 tag 指向乾淨工作樹，再執行：

```bash
APP_MARKETING_VERSION=1.26.0815 ./build.sh
```

預設產物採 ad-hoc 簽章，不適合直接提供一般使用者下載。若要附加正式 `.app` 或 ZIP 到 GitHub Release，應自行完成 Developer ID Application 簽章、Apple notarization、staple 與最終驗證；這些憑證與私有發布腳本不可提交到公開 Repository。

## Release Notes 建議

- 說明主要使用情境與新增功能。
- 列出支援的最低 macOS 與 CPU 架構。
- 清楚標示二進位是否已 Developer ID 簽章及 notarized。
- 連結對應 tag、GPLv3、第三方通知與安全政策。
- 若只有原始碼，請使用者依 README 自行建置，不要暗示 ad-hoc App 可直接安全散布。
