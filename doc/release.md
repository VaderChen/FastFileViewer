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
- [ ] `main.go` 綁定 `Library`、`Media` 與 `Download` 三個服務，且 About 顯示的來源 URL 與 build metadata 一致。
- [ ] `./build.sh` 完整通過。
- [ ] App 內含 GPLv3、第三方授權與 `build-metadata.json`。
- [ ] About 顯示版本、Git tag/commit/build state、GPLv3 與來源 URL。
- [ ] App 與 DMG 均使用 Developer ID Application 簽署並啟用 Hardened Runtime。
- [ ] App 與 DMG 均通過 Apple Notary Service、完成 staple，且 Gatekeeper 驗證成功。

## 建立版本

```bash
git tag -a v1.26.0825 -m "FastFileViewer v1.26.0825"
git push origin main --tags
```

建議讓 tag 指向乾淨工作樹，再執行：

```bash
APP_MARKETING_VERSION=1.26.0825 ./build.sh
```

若要建立已簽署並公證的 DMG，`package-dmg.sh` 會再次要求已追蹤工作樹乾淨，且 HEAD 必須具有 `v1.2.3` 格式的精確 tag：

```bash
./package-dmg.command --build
```

腳本會自動偵測 `Developer ID Application`，並依序尋找 `cert/notary-profile` 指定值、`VaderApp`、`FastFileViewer-notary` 與 `notarytool`。也可使用 `--notary-profile NAME` 明確指定。

若要直接簽署與公證 `dist/FastFileViewer.app`，可無參數執行或直接雙擊 `package-dmg.command`：

```bash
./package-dmg.command
```

此模式不要求 Git tag，輸出檔名會包含 App 的版本與 build label。DMG 使用 Developer ID，不需要 App Store provisioning profile；目前 build metadata 若標示 dirty，產物仍不應當作正式 GitHub Release。

需要本機驗證但不送交公證服務時，可使用 `--skip-notarization` 或 `SKIP_NOTARIZATION=1`；此產物不可直接作為公開 Release。

建立 DMG 前必須使用 Developer ID Application 重新簽署 App，接著依序送交 App 與 DMG 至 Apple Notary Service，完成 staple 後使用 `spctl` 驗證。Release 只上傳已公證的 `FastFileViewer-<version>-arm64.dmg` 與同名 `.sha256`；本機打包腳本、Keychain Profile、憑證及其他發布設定不得提交到公開 Repository。

## Release Notes 建議

- 說明主要使用情境與新增功能。
- 列出支援的最低 macOS 與 CPU 架構。
- 連結對應 tag、GPLv3、第三方通知與安全政策。
- 列出下載檔名與 SHA-256 校驗檔。
- 清楚標示 DMG 已完成 Developer ID 簽署與 Apple 公證。
- 確認 `package-appstore.sh` 的 App 名稱、Bundle ID、Team ID、憑證與 provisioning profile 皆為當次發布設定；該流程不屬於公開 `build.sh`。
