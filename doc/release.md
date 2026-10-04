# GitHub Release Guide

## 版本與文件

後續版本統一使用 **`1.YY.MMDD build HHmm`**。`YY` 為兩位西元年份、`MMDD` 為月日，`HHmm` 為建置開始時本地時間的 24 小時制時分，均保留前導零。

| 用途 | 格式 | 範例 |
| --- | --- | --- |
| App 顯示版本、建置資訊 `version`、Release 標題 | `1.YY.MMDD build HHmm` | `1.26.1003 build 2059` |
| Git tag、附件及版本文件的識別碼 | `1.YY.MMDD-build-HHmm` | `1.26.1003-build-2059` |
| `wails.json` 的 `info.productVersion`、macOS `CFBundleShortVersionString` | `1.YY.MMDD` | `1.26.1003` |
| macOS `CFBundleVersion` | `1.YY.MMDD.HHmm` | `1.26.1003.2059` |

Git tag 不接受空白，因此以連字號表達同一版本。後續 tag 不加 `v` 前綴或 `r2` 等修訂尾碼；同日發行以 `HHmm` 區分。不同內容不得重用同一個 tag；同分鐘已有發行時，於下一分鐘取得新版本。

每次發行先固定以下變數，文件、tag、建置與上傳共用同一組值，避免跨分鐘或午夜後產生不同版本：

```bash
RELEASE_STAMP="$(date '+1.%y.%m%d %H%M')"
RELEASE_VERSION="${RELEASE_STAMP% *}"
RELEASE_BUILD="${RELEASE_STAMP##* }"
RELEASE_TAG="${RELEASE_VERSION}-build-${RELEASE_BUILD}"
RELEASE_DISPLAY="${RELEASE_VERSION} build ${RELEASE_BUILD}"
```

發布前更新 `wails.json` 的數字版本、`CHANGELOG.md`、三語 README 與 `doc/release-${RELEASE_TAG}.md`。效能數據需連結基準方法及量測限制，不可視為整體 App 的等比例提升。

GitHub Release 頁面會顯示發行標題，因此 Release Notes 直接以摘要開頭，後續章節使用 `##` 標題；內文不再重複產品名稱與版本的 `#` 主標題。

專案授權以 `LICENSE.md` 及其翻譯為準。文件、About、npm package metadata、App 內的 `build-metadata.json` 與授權文字應一致；第三方元件保留各自條款。

## 建置與檢查

Apple Silicon Mac 需具備 Go 1.26.6、Node.js／npm、Xcode Command Line Tools、CMake 與 `pkg-config`。

```bash
./scripts/build-codec-deps-macos.sh
./scripts/build-ffmpeg-macos.sh
APP_MARKETING_VERSION="$RELEASE_VERSION" APP_BUILD_LABEL="$RELEASE_BUILD" ./build.sh
```

第一個腳本以固定來源與 SHA-256 建立 macOS 12 的 Opus／libvpx；FFmpeg 腳本優先使用 `third_party/codecs`。App 建置驗證所有影音工具與動態函式庫的最低系統版本，避免本機套件升級改變支援範圍。

`build.sh` 執行依賴驗證、Go vet、race tests、前端測試、TypeScript／Vite build 及 npm production audit，並產生第三方通知及完整授權文字。若通知檔有變更，先納入版本提交。

確認 `Contents/Resources/Licenses` 包含專案與第三方授權，`build-metadata.json` 記錄完整顯示版本、commit、實際 tag、來源 URL 與工作樹狀態。一般建置不自動建立 Git tag。公開原始碼及 App 均需通過 `scripts/check-privacy.mjs`。建置產物、本機設定及 `.bak` 不提交到 Git。

## 標記與正式安裝包

來源及文件驗證完成、工作樹乾淨後建立 tag，再使用固定的版本參數重新建置：

```bash
git tag -a "$RELEASE_TAG" -m "$RELEASE_DISPLAY"
APP_MARKETING_VERSION="$RELEASE_VERSION" APP_BUILD_LABEL="$RELEASE_BUILD" \
BUILD_TAG="$RELEASE_TAG" ./build.sh
```

正式建置指定本機可用的 Developer ID Application 身分；簽章憑證與公證設定只保存在本機。公開 DMG 須完成 App 與 DMG 的簽章、Apple 公證、票據釘選及 Gatekeeper 驗證。解開 DMG 後再次確認 App 版本、來源 commit、內建 FFmpeg／ffprobe、授權及最低 macOS 版本。

正式檔名為 `FastFileViewer-${RELEASE_TAG}-arm64.dmg`，附同名 `.sha256`。先輸出至獨立暫存目錄，完成驗證後再依完整 tag 保存；checksum 內也使用最終檔名。相依套件來源包使用 `FastFileViewer-${RELEASE_TAG}-codec-sources.tar.gz`，提供與安裝包相符的 FFmpeg、Opus、libvpx 原始碼及重建說明。

## 上傳與發布

同步 GitHub 需有使用者的明確要求；建立或發布 Release 則需有對應的發布要求。依當次授權執行下列步驟：

```bash
git push origin main
git push origin "$RELEASE_TAG"
gh release create "$RELEASE_TAG" --verify-tag --draft \
  --title "$RELEASE_DISPLAY" \
  --notes-file "doc/release-${RELEASE_TAG}.md"
gh release upload "$RELEASE_TAG" \
  "dist/FastFileViewer-${RELEASE_TAG}-arm64.dmg" \
  "dist/FastFileViewer-${RELEASE_TAG}-arm64.dmg.sha256" \
  "dist/FastFileViewer-${RELEASE_TAG}-codec-sources.tar.gz" \
  "dist/FastFileViewer-${RELEASE_TAG}-codec-sources.tar.gz.sha256"
gh release edit "$RELEASE_TAG" --draft=false --latest
```

發布後核對遠端 main、tag、Release 指向相同 commit，確認附件名稱、大小與下載後的 SHA-256。Release Notes 說明使用者可感受到的改善、相容性及下載方式。

## App 內自動更新

App 從 GitHub `releases/latest` 讀取正式發行資訊，忽略草稿與預覽版本；同時支援舊版 `v1.YY.MMDD-rN` 與目前的日期／時間 tag。請先在草稿上傳完整附件，再發布為 Latest，避免使用者取得未完成的發行資訊。

自動更新使用 `FastFileViewer-${RELEASE_TAG}-arm64.dmg`。GitHub 資產資訊必須包含正確大小與 `sha256:` digest；安裝包內的 `FastFileViewer.app`、`build-metadata.json` 的 `tag` 必須與該 Release 一致。App 須由與已安裝版本相同的 Developer ID 團隊簽署、通過 Gatekeeper，並正確記錄 `LSMinimumSystemVersion`。既有發行資產不可覆寫為不同內容。

更新器在可寫入的安裝目錄旁建立私人暫存目錄，驗證及準備完成後啟動獨立進度視窗，再關閉主程式。新版 React 畫面回報啟動成功後才清除原版；替換或重啟失敗時嘗試還原並重新開啟原版。若還原也失敗，暫存目錄中的 `previous.app` 會保留供復原。下載失敗、取消與驗證失敗均不替換已安裝 App。更新不使用 GitHub token，也不改變既有認證方式。

更新助手使用原 App 的完整簽章 Bundle 副本，包含 Info.plist、資源與簽章；單獨複製主執行檔會使 macOS 無法驗證並啟動助手。

發行前可將 `FASTFILEVIEWER_UPDATE_TEST_APP` 指向已簽章、公證的 App，執行 `go test ./internal/updater -run "TestSigned(Release|InstallerLaunch)Fixture" -v`。除了簽章、Gatekeeper、版本及系統相容性，也必須確認助手能實際啟動 WebKit 進度視窗並回報就緒。助手測試會使用暫存 App 副本，在原程式等待階段結束助手；指定的安裝內容不會被替換。

若使用者的舊版在更新準備階段約 65% 失敗，Release Notes 須提供 DMG 手動更新一次的方式。更新助手的修正隨新版 App 提供，無法回溯修改已安裝舊版的更新程式。
