# GitHub Release Guide

## 公開原則

GitHub 公開來源只包含可重現建置所需的原始碼、通用腳本、圖示及授權文件；個人化設定與內部操作均不放入 Repository。

## 發布前檢查

- [ ] README、授權文件與第三方通知內容一致。
- [ ] `.env*`、`build/bin/`、`dist/`、`frontend/dist/`、安裝包與本機發布資產未加入 Git。
- [ ] 原始碼不存在密碼、Token 或個人絕對路徑。
- [ ] `go.mod` module 為 `github.com/VaderChen/FastFileViewer`。
- [ ] `./build.sh` 完整通過。
- [ ] App 內含 GPLv3、第三方授權與 build metadata。
- [ ] About 顯示版本、Git tag／commit、建置狀態與授權資訊。

## 建立版本

```bash
git tag -a v1.26.0825 -m "FastFileViewer v1.26.0825"
git push origin main --tags
```

建議讓 tag 指向乾淨工作樹，再執行：

```bash
APP_MARKETING_VERSION=1.26.0825 ./build.sh
```

## Release Notes 建議

- 說明主要使用情境與新增功能。
- 列出支援的最低 macOS 與 CPU 架構。
- 列出正式下載檔名。
- 僅公開必要的使用者資訊，避免揭露內部操作或驗證細節。
