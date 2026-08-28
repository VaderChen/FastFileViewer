package app

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf16"
	"unicode/utf8"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	_ "golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
)

const maxImageBytes int64 = 128 * 1024 * 1024
const maxDocumentBytes int64 = 8 * 1024 * 1024
const maxThumbnailInputBytes int64 = 64 * 1024 * 1024
const maxExportBytes int64 = 4 * 1024 * 1024 * 1024
const maxDecodedImagePixels int64 = 50_000_000
const maxLibraryCacheBytes int64 = 64 * 1024 * 1024
const maxLibraryCacheFiles = 8
const maxThumbnailCacheBytes int64 = 16 * 1024 * 1024
const maxThumbnailCacheFiles = 1200

var errOperationCancelled = errors.New("操作已取消")
var thumbnailSlots = make(chan struct{}, 3)

var appVersion = "development"
var appCommit = "unknown"
var appTag = "untagged"
var appBuildState = "unknown"
var appSourceURL = "https://github.com/VaderChen/FastFileViewer"
var userCacheDir = os.UserCacheDir

var supportedImageExtensions = []string{
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".svg",
	".tif",
	".tiff",
	".heic",
}

var supportedDocumentExtensions = []string{
	".pdf",
	".txt",
	".md",
	".markdown",
	".go",
	".rs",
	".c",
	".h",
	".cc",
	".cpp",
	".cxx",
	".hpp",
	".cs",
	".java",
	".kt",
	".kts",
	".swift",
	".m",
	".mm",
	".py",
	".pyw",
	".rb",
	".php",
	".js",
	".jsx",
	".ts",
	".tsx",
	".vue",
	".svelte",
	".html",
	".htm",
	".css",
	".scss",
	".sass",
	".less",
	".json",
	".jsonc",
	".xml",
	".yaml",
	".yml",
	".toml",
	".ini",
	".conf",
	".config",
	".env",
	".properties",
	".sql",
	".graphql",
	".gql",
	".sh",
	".bash",
	".zsh",
	".fish",
	".ps1",
	".bat",
	".cmd",
	".lua",
	".pl",
	".r",
	".dart",
	".ex",
	".exs",
	".erl",
	".hrl",
	".fs",
	".fsx",
	".vb",
	".scala",
	".clj",
	".cljs",
	".hs",
	".lhs",
	".sol",
	".asm",
	".s",
	".dockerfile",
	".makefile",
	".gradle",
	".lock",
	".log",
	".csv",
	".tsv",
}

var supportedMediaExtensions = []string{
	".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".m2ts",
	".mp3", ".mp2", ".m4a", ".m4b", ".wav", ".aac", ".flac", ".ogg", ".oga", ".opus",
	".aif", ".aiff", ".aifc", ".caf", ".wma", ".ape", ".wv", ".alac", ".ac3", ".amr", ".mka",
	".srt", ".vtt", ".ass", ".ssa", ".sub", ".smi",
}

var supportedArchiveExtensions = []string{
	".zip",
	".tar",
	".tgz",
	".tar.gz",
}

// App 是圖庫服務：掃描、縮圖、文件讀取與可取消操作的進入點。
type App struct {
	ctx              context.Context
	entries          *entryRegistry
	operations       *operationRegistry
	media            *MediaService
	thumbnailOnce    sync.Once
	libraryCacheMu   sync.Mutex
	openFileMu       sync.Mutex
	pendingOpenFiles []string
}

// Services 是綁定到前端的服務集合，各自持有自己的狀態與鎖。
type Services struct {
	Library  *App
	Media    *MediaService
	Download *DownloadService
	File     *FileService
}

// New 會建立互相串接好的服務集合。
func New() *Services {
	entries := newEntryRegistry()
	operations := newOperationRegistry()
	media := newMediaService(entries, operations)
	return &Services{
		Library:  &App{entries: entries, operations: operations, media: media},
		Media:    media,
		Download: newDownloadService(),
		File:     newFileService(entries),
	}
}

// Startup 會把應用程式生命週期傳給每一個服務。
func (s *Services) Startup(ctx context.Context) {
	s.Library.Startup(ctx)
	s.Media.Startup(ctx)
	s.Download.Startup(ctx)
	s.File.Startup(ctx)
}

// Shutdown 會釋放各服務持有的暫存資源。
func (s *Services) Shutdown() {
	s.Download.cleanup()
	s.Media.cleanup()
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	a.operations.adopt(ctx)
}

// QueueOpenFile 接收 macOS「以此 App 開啟」傳入的檔案。前端尚未 ready 時先排隊，
// ready 後由 ConsumeOpenFilePaths 取出；App 已啟動時同時發送事件以立即更新畫面。
func (a *App) QueueOpenFile(filePath string) {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return
	}
	a.openFileMu.Lock()
	for _, pending := range a.pendingOpenFiles {
		if pending == filePath {
			a.openFileMu.Unlock()
			return
		}
	}
	a.pendingOpenFiles = append(a.pendingOpenFiles, filePath)
	ctx := a.ctx
	a.openFileMu.Unlock()
	if ctx != nil {
		wailsruntime.EventsEmit(ctx, "fastfileviewer:file-open", filePath)
	}
}

// ConsumeOpenFilePaths 取出啟動期間累積的檔案開啟請求。
func (a *App) ConsumeOpenFilePaths() []string {
	a.openFileMu.Lock()
	defer a.openFileMu.Unlock()
	paths := append([]string(nil), a.pendingOpenFiles...)
	a.pendingOpenFiles = nil
	return paths
}

func (a *App) BeginOperation() int64 {
	return a.operations.begin()
}

func (a *App) CancelOperation(operationID int64) {
	a.operations.cancel(operationID)
}

func (a *App) FinishOperation(operationID int64) {
	a.operations.finish(operationID)
}

func (a *App) operationContext(operationID int64) context.Context {
	return a.operations.context(operationID)
}

func (a *App) Bootstrap() BootstrapPayload {
	home, _ := os.UserHomeDir()
	return BootstrapPayload{
		DefaultPath:        home,
		SupportedImages:    append([]string{}, supportedImageExtensions...),
		SupportedDocuments: append([]string{}, supportedDocumentExtensions...),
		SupportedMedia:     append([]string{}, supportedMediaExtensions...),
		SupportedPacks:     append([]string{}, supportedArchiveExtensions...),
	}
}

func (a *App) LoadLibraryCache(rootPath string) (string, error) {
	cachePath, err := libraryCachePath(rootPath)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(cachePath)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("讀取目錄快取失敗: %w", err)
	}
	if info.Size() > maxLibraryCacheBytes {
		return "", fmt.Errorf("目錄快取超過 %d MB 上限", maxLibraryCacheBytes/(1024*1024))
	}
	payload, err := os.ReadFile(cachePath)
	if err != nil {
		return "", fmt.Errorf("讀取目錄快取失敗: %w", err)
	}
	return string(payload), nil
}

func (a *App) SaveLibraryCache(rootPath string, payload string) error {
	a.libraryCacheMu.Lock()
	defer a.libraryCacheMu.Unlock()

	if int64(len(payload)) > maxLibraryCacheBytes {
		return fmt.Errorf("目錄快取超過 %d MB 上限", maxLibraryCacheBytes/(1024*1024))
	}
	cachePath, err := libraryCachePath(rootPath)
	if err != nil {
		return err
	}
	cacheDirectory := filepath.Dir(cachePath)
	if err := os.MkdirAll(cacheDirectory, 0o700); err != nil {
		return fmt.Errorf("建立目錄快取資料夾失敗: %w", err)
	}
	temporaryFile, err := os.CreateTemp(cacheDirectory, ".library-cache-*")
	if err != nil {
		return fmt.Errorf("建立目錄快取暫存檔失敗: %w", err)
	}
	temporaryPath := temporaryFile.Name()
	defer os.Remove(temporaryPath)
	if err := temporaryFile.Chmod(0o600); err != nil {
		temporaryFile.Close()
		return fmt.Errorf("設定目錄快取權限失敗: %w", err)
	}
	if _, err := io.WriteString(temporaryFile, payload); err != nil {
		temporaryFile.Close()
		return fmt.Errorf("寫入目錄快取失敗: %w", err)
	}
	if err := temporaryFile.Sync(); err != nil {
		temporaryFile.Close()
		return fmt.Errorf("同步目錄快取失敗: %w", err)
	}
	if err := temporaryFile.Close(); err != nil {
		return fmt.Errorf("關閉目錄快取失敗: %w", err)
	}
	if err := os.Rename(temporaryPath, cachePath); err != nil {
		return fmt.Errorf("更新目錄快取失敗: %w", err)
	}
	pruneLibraryCaches(cacheDirectory, cachePath)
	return nil
}

func (a *App) GetAppInfo() AppInfo {
	return AppInfo{
		HardwareInfo: currentHardwareInfo(),
		OSVersion:    currentOSVersion(),
		AppVersion:   appVersion,
		Commit:       appCommit,
		Tag:          appTag,
		BuildState:   appBuildState,
		SourceURL:    appSourceURL,
		License:      "GNU General Public License v3.0",
	}
}

func (a *App) SelectDirectory(dialogTitle string) (string, error) {
	if a.ctx == nil {
		return "", nil
	}
	dialogTitle = strings.TrimSpace(dialogTitle)
	if dialogTitle == "" {
		dialogTitle = "Select folder"
	}
	return wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: dialogTitle,
	})
}

func (a *App) LoadThumbnailByPath(filePath string, maxDimension int) (ImagePayload, error) {
	entry, err := entryByPath(filePath)
	if err != nil {
		return ImagePayload{}, err
	}
	if entry.Kind != "image" {
		return ImagePayload{}, fmt.Errorf("不是支援的圖片: %s", entry.Name)
	}
	if maxDimension < 64 {
		maxDimension = 64
	}
	if maxDimension > 640 {
		maxDimension = 640
	}

	thumbnailSlots <- struct{}{}
	defer func() { <-thumbnailSlots }()

	cachePath, cachePathErr := thumbnailCachePath(entry, maxDimension)
	if cachePathErr == nil {
		a.thumbnailOnce.Do(func() {
			_ = os.MkdirAll(filepath.Dir(cachePath), 0o700)
			pruneCacheFiles(filepath.Dir(cachePath), maxThumbnailCacheFiles)
		})
		if cachedData, cacheErr := readThumbnailCache(cachePath); cacheErr == nil {
			return thumbnailPayloadFromData(entry, cachedData), nil
		}
	}

	entryData, err := readEntryLimited(entry, maxThumbnailInputBytes)
	if err != nil {
		return ImagePayload{}, err
	}
	if entry.Format == ".svg" {
		return imagePayloadFromData(entry, entryData), nil
	}

	config, _, err := image.DecodeConfig(bytes.NewReader(entryData))
	if err != nil {
		return ImagePayload{}, fmt.Errorf("無法產生 %s 縮圖: %w", entry.Name, err)
	}
	if err := validateImageDimensions(config.Width, config.Height); err != nil {
		return ImagePayload{}, err
	}
	decoded, _, err := image.Decode(bytes.NewReader(entryData))
	if err != nil {
		return ImagePayload{}, fmt.Errorf("無法解碼 %s: %w", entry.Name, err)
	}

	bounds := decoded.Bounds()
	width, height := scaledDimensions(bounds.Dx(), bounds.Dy(), maxDimension)
	thumbnail := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.BiLinear.Scale(thumbnail, thumbnail.Bounds(), decoded, bounds, draw.Over, nil)

	var encoded bytes.Buffer
	thumbnailEncoder := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := thumbnailEncoder.Encode(&encoded, thumbnail); err != nil {
		return ImagePayload{}, err
	}
	thumbnailData := encoded.Bytes()
	if cachePathErr == nil {
		_ = writeThumbnailCache(cachePath, thumbnailData)
	}
	return thumbnailPayloadFromData(entry, thumbnailData), nil
}

func (a *App) LoadDocumentByPath(filePath string) (DocumentPayload, error) {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return DocumentPayload{}, errors.New("文件路徑不可空白")
	}

	entry, err := entryByPath(filePath)
	if err != nil {
		return DocumentPayload{}, err
	}
	if entry.Kind == "image" || entry.Kind == "video" || entry.Kind == "audio" || entry.Kind == "pdf" {
		return DocumentPayload{}, fmt.Errorf("不是支援的文字文件: %s", entry.Name)
	}

	data, err := readEntryLimited(entry, maxDocumentBytes)
	if err != nil {
		return DocumentPayload{}, err
	}
	if reason := binaryDocumentReason(data); reason != "" {
		return DocumentPayload{}, fmt.Errorf("無法預覽二進位檔案 %s：%s", entry.Name, reason)
	}
	location := entry.Path
	if entry.Source == "archive" {
		location = entry.ArchivePath + "::" + entry.InnerPath
	}
	return DocumentPayload{
		ID:       entry.ID,
		Name:     entry.Name,
		Text:     decodeDocumentText(data),
		Format:   entry.Format,
		Source:   entry.Source,
		Location: location,
	}, nil
}

// PrepareDocumentByPath 會註冊已驗證的 PDF 項目，並回傳本機串流網址。
// 壓縮檔內的 PDF 會先解壓到媒體暫存目錄，關閉應用程式時由既有清理流程移除。
func (a *App) PrepareDocumentByPath(filePath string, operationID int64) (string, error) {
	return a.media.PrepareDocumentByPath(filePath, operationID)
}

func (a *App) ExportImages(images []ImageEntry, dialogTitle string, operationID int64) (ExportResult, error) {
	if len(images) == 0 {
		return ExportResult{}, errors.New("請先選擇要匯出的項目")
	}
	if a.ctx == nil {
		return ExportResult{}, errors.New("應用程式尚未完成初始化")
	}
	destination, err := wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{Title: dialogTitle})
	if err != nil || destination == "" {
		return ExportResult{}, err
	}
	operationCtx := a.operationContext(operationID)
	defer a.FinishOperation(operationID)

	result := ExportResult{Destination: destination}
	usedNames := make(map[string]bool)
	for _, entry := range images {
		if err := checkOperation(operationCtx); err != nil {
			return result, err
		}
		fileName := uniqueExportName(destination, entry.Name, usedNames)
		if writeErr := copyEntryToFile(operationCtx, entry, filepath.Join(destination, fileName)); writeErr != nil {
			if errors.Is(writeErr, errOperationCancelled) {
				return result, writeErr
			}
			result.Skipped++
			continue
		}
		usedNames[fileName] = true
		result.Exported++
	}
	return result, nil
}

func (a *App) DetectDuplicates(images []ImageEntry, operationID int64) ([]DuplicateGroup, error) {
	operationCtx := a.operationContext(operationID)
	defer a.FinishOperation(operationID)

	sizeGroups := make(map[int64][]ImageEntry)
	for _, entry := range images {
		sizeGroups[entry.Size] = append(sizeGroups[entry.Size], entry)
	}

	groups := make(map[string][]ImageEntry)
	for _, entries := range sizeGroups {
		if len(entries) < 2 {
			continue
		}
		for _, entry := range entries {
			if err := checkOperation(operationCtx); err != nil {
				return nil, err
			}
			hash, err := hashEntry(operationCtx, entry)
			if err != nil {
				if errors.Is(err, errOperationCancelled) {
					return nil, err
				}
				continue
			}
			groups[hash] = append(groups[hash], entry)
		}
	}

	duplicates := make([]DuplicateGroup, 0)
	for hash, entries := range groups {
		if len(entries) < 2 {
			continue
		}
		var totalBytes int64
		for _, entry := range entries {
			totalBytes += entry.Size
		}
		duplicates = append(duplicates, DuplicateGroup{Hash: hash, TotalBytes: totalBytes, Images: entries})
	}
	sort.Slice(duplicates, func(i, j int) bool {
		if len(duplicates[i].Images) != len(duplicates[j].Images) {
			return len(duplicates[i].Images) > len(duplicates[j].Images)
		}
		return duplicates[i].TotalBytes > duplicates[j].TotalBytes
	})
	return duplicates, nil
}

func (a *App) CalculateChecksum(entry ImageEntry, operationID int64) (string, error) {
	operationCtx := a.operationContext(operationID)
	defer a.FinishOperation(operationID)
	return hashEntry(operationCtx, entry)
}

func (a *App) ResetLibrary() {
	a.entries.reset()
	a.media.cleanup()
}

func (a *App) ScanDirectory(directoryPath string, enabledImageExtensions []string, enabledDocumentExtensions []string, enabledMediaExtensions []string, operationID int64) (DirectoryScanResult, error) {
	operationCtx := a.operationContext(operationID)
	if err := checkOperation(operationCtx); err != nil {
		return DirectoryScanResult{}, err
	}
	directoryPath = strings.TrimSpace(directoryPath)
	if directoryPath == "" {
		return DirectoryScanResult{}, errors.New("請先選擇目錄")
	}
	imageExtensionFilter := newExtensionFilter(enabledImageExtensions, supportedImageExtensions)
	documentExtensionFilter := newExtensionFilter(enabledDocumentExtensions, supportedDocumentExtensions)
	mediaExtensionFilter := newExtensionFilter(enabledMediaExtensions, supportedMediaExtensions)

	absPath, err := filepath.Abs(directoryPath)
	if err != nil {
		return DirectoryScanResult{}, err
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return DirectoryScanResult{}, err
	}
	if !info.IsDir() {
		return DirectoryScanResult{}, fmt.Errorf("不是有效目錄: %s", absPath)
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		return DirectoryScanResult{}, err
	}

	node := &LibraryNode{
		ID:       nodeID(absPath),
		Name:     displayName(absPath),
		Path:     absPath,
		Kind:     "directory",
		Scanned:  true,
		Images:   []ImageEntry{},
		Children: []LibraryNode{},
	}
	warnings := []string{}

	for _, entry := range entries {
		if err := checkOperation(operationCtx); err != nil {
			return DirectoryScanResult{}, err
		}
		if shouldIgnoreEntryName(entry.Name()) {
			continue
		}
		childPath := filepath.Join(absPath, entry.Name())
		if entry.IsDir() {
			node.Children = append(node.Children, buildDirectoryNode(childPath, false))
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		extension := normalizedExtension(childPath)
		if isEnabledExtension(extension, imageExtensionFilter) || isEnabledExtension(extension, documentExtensionFilter) || isEnabledExtension(extension, mediaExtensionFilter) {
			image := buildFileImageEntry(childPath, info.Size())
			node.Images = append(node.Images, image)
			a.rememberImage(image)
			continue
		}
		if isSupportedArchive(extension) {
			archiveNode, err := a.scanArchiveNode(operationCtx, childPath, imageExtensionFilter, documentExtensionFilter, mediaExtensionFilter)
			if errors.Is(err, errOperationCancelled) {
				return DirectoryScanResult{}, err
			}
			if err == nil && (len(archiveNode.Images) > 0 || len(archiveNode.Children) > 0) {
				node.Children = append(node.Children, archiveNode)
			} else if err != nil {
				warnings = append(warnings, fmt.Sprintf("%s: %v", filepath.Base(childPath), err))
			}
		}
	}

	sort.SliceStable(node.Images, func(i, j int) bool {
		return strings.ToLower(node.Images[i].Name) < strings.ToLower(node.Images[j].Name)
	})
	sort.SliceStable(node.Children, func(i, j int) bool {
		if node.Children[i].Kind != node.Children[j].Kind {
			return kindRank(node.Children[i].Kind) < kindRank(node.Children[j].Kind)
		}
		return strings.ToLower(node.Children[i].Name) < strings.ToLower(node.Children[j].Name)
	})

	return DirectoryScanResult{
		RootPath: absPath,
		Node:     node,
		Warnings: warnings,
	}, nil
}

func (a *App) LoadImage(id string) (ImagePayload, error) {
	entry, ok := a.entries.lookup(id)
	if !ok {
		return ImagePayload{}, fmt.Errorf("找不到圖片: %s", id)
	}

	return loadImagePayload(entry)
}

func (a *App) LoadImageByPath(filePath string) (ImagePayload, error) {
	return a.LoadImageByPathWithOperation(filePath, 0)
}

func (a *App) LoadImageByPathWithOperation(filePath string, operationID int64) (ImagePayload, error) {
	entry, err := entryByPath(filePath)
	if err != nil {
		return ImagePayload{}, err
	}
	if entry.Kind != "image" {
		return ImagePayload{}, fmt.Errorf("不是支援的圖片: %s", entry.Name)
	}
	a.rememberImage(entry)
	return loadImagePayloadWithContext(a.operationContext(operationID), entry)
}

func (a *App) rememberImage(image ImageEntry) {
	a.entries.remember(image)
}

func libraryCachePath(rootPath string) (string, error) {
	trimmedPath := strings.TrimSpace(rootPath)
	if trimmedPath == "" {
		return "", errors.New("目錄快取路徑不可為空")
	}
	cacheRoot, err := userCacheDir()
	if err != nil {
		return "", fmt.Errorf("取得系統快取資料夾失敗: %w", err)
	}
	digest := sha256.Sum256([]byte(filepath.Clean(trimmedPath)))
	fileName := hex.EncodeToString(digest[:]) + ".json"
	return filepath.Join(cacheRoot, "FastFileViewer", "library-cache-v3", fileName), nil
}

func pruneLibraryCaches(cacheDirectory string, currentPath string) {
	entries, err := os.ReadDir(cacheDirectory)
	if err != nil {
		return
	}
	type cacheFile struct {
		path    string
		modTime int64
	}
	cacheFiles := make([]cacheFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		entryPath := filepath.Join(cacheDirectory, entry.Name())
		info, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}
		cacheFiles = append(cacheFiles, cacheFile{path: entryPath, modTime: info.ModTime().UnixNano()})
	}
	if len(cacheFiles) <= maxLibraryCacheFiles {
		return
	}
	sort.Slice(cacheFiles, func(left int, right int) bool {
		return cacheFiles[left].modTime < cacheFiles[right].modTime
	})
	removeCount := len(cacheFiles) - maxLibraryCacheFiles
	for _, cacheFile := range cacheFiles {
		if removeCount == 0 {
			break
		}
		if cacheFile.path == currentPath {
			continue
		}
		if os.Remove(cacheFile.path) == nil {
			removeCount--
		}
	}
}

func entryByPath(filePath string) (ImageEntry, error) {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return ImageEntry{}, errors.New("檔案路徑不可空白")
	}
	if archivePath, innerPath, ok := splitArchiveEntryPath(filePath); ok {
		return buildArchiveImageEntry(archivePath, innerPath, 0), nil
	}

	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return ImageEntry{}, err
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return ImageEntry{}, err
	}
	if info.IsDir() {
		return ImageEntry{}, fmt.Errorf("不是有效檔案: %s", absPath)
	}
	if !isSupportedEntry(normalizedExtension(absPath)) {
		return ImageEntry{}, fmt.Errorf("不支援的檔案格式: %s", normalizedExtension(absPath))
	}
	return buildFileImageEntry(absPath, info.Size()), nil
}

func loadImagePayload(entry ImageEntry) (ImagePayload, error) {
	return loadImagePayloadWithContext(context.Background(), entry)
}

func loadImagePayloadWithContext(operationCtx context.Context, entry ImageEntry) (ImagePayload, error) {
	data, err := readEntryLimitedWithContext(operationCtx, entry, maxImageBytes)
	if err != nil {
		return ImagePayload{}, err
	}
	if err := checkOperation(operationCtx); err != nil {
		return ImagePayload{}, err
	}
	if err := validateImageData(entry, data); err != nil {
		return ImagePayload{}, err
	}
	if err := checkOperation(operationCtx); err != nil {
		return ImagePayload{}, err
	}
	return imagePayloadFromData(entry, data), nil
}

func imagePayloadFromData(entry ImageEntry, data []byte) ImagePayload {
	mime := mimeByExtension(entry.Format)
	location := entry.Path
	if entry.Source == "archive" {
		location = entry.ArchivePath + "::" + entry.InnerPath
	}
	payload := ImagePayload{
		ID:       entry.ID,
		Name:     entry.Name,
		MIME:     mime,
		Source:   entry.Source,
		Location: location,
	}
	if data != nil {
		payload.DataURI = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
	}
	return payload
}

func thumbnailPayloadFromData(entry ImageEntry, data []byte) ImagePayload {
	payload := imagePayloadFromData(entry, nil)
	payload.MIME = "image/png"
	payload.DataURI = "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
	return payload
}

func validateImageData(entry ImageEntry, data []byte) error {
	if entry.Format == ".svg" || entry.Format == ".heic" {
		return nil
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("無法解析圖片 %s: %w", entry.Name, err)
	}
	return validateImageDimensions(config.Width, config.Height)
}

func validateImageDimensions(width int, height int) error {
	if width <= 0 || height <= 0 {
		return errors.New("圖片尺寸無效")
	}
	if int64(width) > maxDecodedImagePixels/int64(height) {
		return fmt.Errorf("圖片解碼尺寸超過安全上限 %d megapixels", maxDecodedImagePixels/1_000_000)
	}
	return nil
}

func buildDirectoryNode(directoryPath string, scanned bool) LibraryNode {
	return LibraryNode{
		ID:       nodeID(directoryPath),
		Name:     displayName(directoryPath),
		Path:     directoryPath,
		Kind:     "directory",
		Scanned:  scanned,
		Images:   []ImageEntry{},
		Children: []LibraryNode{},
	}
}

func buildArchiveNode(archivePath string) LibraryNode {
	return LibraryNode{
		ID:       hashID("archive-node", archivePath),
		Name:     filepath.Base(archivePath),
		Path:     archivePath,
		Kind:     "archive",
		Scanned:  true,
		Images:   []ImageEntry{},
		Children: []LibraryNode{},
	}
}

func buildFileImageEntry(filePath string, size int64) ImageEntry {
	directory := filepath.Dir(filePath)
	return ImageEntry{
		ID:            hashID("file", filePath),
		Name:          filepath.Base(filePath),
		Path:          filePath,
		DirectoryPath: directory,
		Source:        "file",
		Format:        normalizedExtension(filePath),
		Kind:          entryKind(normalizedExtension(filePath)),
		Size:          size,
	}
}

func buildArchiveImageEntry(archivePath string, innerPath string, size int64) ImageEntry {
	cleanInnerPath := strings.Trim(path.Clean(innerPath), "/")
	innerDirectory := path.Dir(cleanInnerPath)
	if innerDirectory == "." {
		innerDirectory = ""
	}
	directoryPath := archivePath
	if innerDirectory != "" {
		directoryPath = archivePath + "::" + innerDirectory
	}
	return ImageEntry{
		ID:            hashID("archive", archivePath, cleanInnerPath),
		Name:          path.Base(cleanInnerPath),
		Path:          archivePath + "::" + cleanInnerPath,
		DirectoryPath: directoryPath,
		Source:        "archive",
		ArchivePath:   archivePath,
		InnerPath:     cleanInnerPath,
		Format:        normalizedArchiveExtension(cleanInnerPath),
		Kind:          entryKind(normalizedArchiveExtension(cleanInnerPath)),
		Size:          size,
	}
}

func (a *App) scanArchiveNode(operationCtx context.Context, archivePath string, imageExtensionFilter map[string]bool, documentExtensionFilter map[string]bool, mediaExtensionFilter map[string]bool) (LibraryNode, error) {
	archiveNode := buildArchiveNode(archivePath)
	var images []ImageEntry
	var err error
	if normalizedExtension(archivePath) == ".zip" {
		images, err = scanZipArchiveImages(operationCtx, archivePath, imageExtensionFilter, documentExtensionFilter, mediaExtensionFilter)
	} else {
		images, err = scanTarArchiveImages(operationCtx, archivePath, imageExtensionFilter, documentExtensionFilter, mediaExtensionFilter)
	}
	if err != nil {
		return archiveNode, err
	}
	for _, image := range images {
		addArchiveImageToNode(&archiveNode, image)
		a.rememberImage(image)
	}
	sortLibraryNode(&archiveNode)
	return archiveNode, nil
}

func scanZipArchiveImages(operationCtx context.Context, archivePath string, imageExtensionFilter map[string]bool, documentExtensionFilter map[string]bool, mediaExtensionFilter map[string]bool) ([]ImageEntry, error) {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	var images []ImageEntry
	for _, file := range reader.File {
		if err := checkOperation(operationCtx); err != nil {
			return nil, err
		}
		if file.FileInfo().IsDir() {
			continue
		}
		entryName := normalizeZipEntryName(file)
		if shouldIgnoreArchiveEntry(entryName) {
			continue
		}
		extension := normalizedArchiveExtension(entryName)
		if !isEnabledExtension(extension, imageExtensionFilter) && !isEnabledExtension(extension, documentExtensionFilter) && !isEnabledExtension(extension, mediaExtensionFilter) {
			continue
		}
		images = append(images, buildArchiveImageEntry(archivePath, entryName, int64(file.UncompressedSize64)))
	}
	return images, nil
}

func scanTarArchiveImages(operationCtx context.Context, archivePath string, imageExtensionFilter map[string]bool, documentExtensionFilter map[string]bool, mediaExtensionFilter map[string]bool) ([]ImageEntry, error) {
	file, err := os.Open(archivePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	source, closeSource, err := tarSourceReader(file, archivePath)
	if err != nil {
		return nil, err
	}
	if closeSource != nil {
		defer closeSource()
	}

	reader := tar.NewReader(source)
	var images []ImageEntry
	for {
		if err := checkOperation(operationCtx); err != nil {
			return nil, err
		}
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return images, err
		}
		if header.FileInfo().IsDir() {
			continue
		}
		entryName := normalizeArchiveEntryName(header.Name)
		if shouldIgnoreArchiveEntry(entryName) {
			continue
		}
		extension := normalizedArchiveExtension(entryName)
		if !isEnabledExtension(extension, imageExtensionFilter) && !isEnabledExtension(extension, documentExtensionFilter) && !isEnabledExtension(extension, mediaExtensionFilter) {
			continue
		}
		images = append(images, buildArchiveImageEntry(archivePath, entryName, header.Size))
	}
	return images, nil
}

func addArchiveImageToNode(root *LibraryNode, image ImageEntry) {
	innerDirectory := path.Dir(image.InnerPath)
	if innerDirectory == "." || innerDirectory == "" {
		root.Images = append(root.Images, image)
		return
	}

	current := root
	accumulated := ""
	for _, part := range strings.Split(innerDirectory, "/") {
		if part == "" || part == "." {
			continue
		}
		if accumulated == "" {
			accumulated = part
		} else {
			accumulated += "/" + part
		}
		virtualPath := root.Path + "::" + accumulated
		childIndex := -1
		for index := range current.Children {
			if current.Children[index].Path == virtualPath {
				childIndex = index
				break
			}
		}
		if childIndex < 0 {
			current.Children = append(current.Children, LibraryNode{
				ID:       hashID("archive-dir", virtualPath),
				Name:     part,
				Path:     virtualPath,
				Kind:     "directory",
				Scanned:  true,
				Images:   []ImageEntry{},
				Children: []LibraryNode{},
			})
			childIndex = len(current.Children) - 1
		}
		current = &current.Children[childIndex]
	}
	current.Images = append(current.Images, image)
}

func sortLibraryNode(node *LibraryNode) {
	sort.SliceStable(node.Images, func(i, j int) bool {
		return strings.ToLower(node.Images[i].Name) < strings.ToLower(node.Images[j].Name)
	})
	sort.SliceStable(node.Children, func(i, j int) bool {
		if node.Children[i].Kind != node.Children[j].Kind {
			return kindRank(node.Children[i].Kind) < kindRank(node.Children[j].Kind)
		}
		return strings.ToLower(node.Children[i].Name) < strings.ToLower(node.Children[j].Name)
	})
	for index := range node.Children {
		sortLibraryNode(&node.Children[index])
	}
}

func readEntryLimited(entry ImageEntry, limit int64) ([]byte, error) {
	return readEntryLimitedWithContext(context.Background(), entry, limit)
}

func readEntryLimitedWithContext(operationCtx context.Context, entry ImageEntry, limit int64) ([]byte, error) {
	if entry.Size > limit {
		return nil, fmt.Errorf("%s 超過讀取上限 %d MB", entry.Name, limit/1024/1024)
	}
	reader, err := openEntryReader(operationCtx, entry)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s 超過讀取上限 %d MB", entry.Name, limit/1024/1024)
	}
	return data, nil
}

func thumbnailCachePath(entry ImageEntry, maxDimension int) (string, error) {
	cacheRoot, err := userCacheDir()
	if err != nil {
		return "", err
	}
	sourcePath := entry.Path
	if entry.Source == "archive" {
		sourcePath = entry.ArchivePath
	}
	info, err := os.Stat(sourcePath)
	if err != nil {
		return "", err
	}
	cacheKey := strings.Join([]string{
		filepath.Clean(sourcePath),
		entry.InnerPath,
		strconv.FormatInt(entry.Size, 10),
		strconv.FormatInt(info.ModTime().UnixNano(), 10),
		strconv.Itoa(maxDimension),
	}, "\x00")
	digest := sha256.Sum256([]byte(cacheKey))
	return filepath.Join(cacheRoot, "FastFileViewer", "thumbnails-v1", hex.EncodeToString(digest[:])+".png"), nil
}

func readThumbnailCache(cachePath string) ([]byte, error) {
	info, err := os.Stat(cachePath)
	if err != nil {
		return nil, err
	}
	if info.Size() <= 0 || info.Size() > maxThumbnailCacheBytes {
		return nil, errors.New("縮圖快取大小無效")
	}
	return os.ReadFile(cachePath)
}

func writeThumbnailCache(cachePath string, data []byte) error {
	if int64(len(data)) > maxThumbnailCacheBytes {
		return errors.New("縮圖快取超過大小上限")
	}
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o700); err != nil {
		return err
	}
	temporaryFile, err := os.CreateTemp(filepath.Dir(cachePath), ".thumbnail-*")
	if err != nil {
		return err
	}
	temporaryPath := temporaryFile.Name()
	defer os.Remove(temporaryPath)
	if err := temporaryFile.Chmod(0o600); err != nil {
		temporaryFile.Close()
		return err
	}
	if _, err := temporaryFile.Write(data); err != nil {
		temporaryFile.Close()
		return err
	}
	if err := temporaryFile.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, cachePath)
}

func pruneCacheFiles(cacheDirectory string, maxFiles int) {
	entries, err := os.ReadDir(cacheDirectory)
	if err != nil || len(entries) <= maxFiles {
		return
	}
	type cacheFile struct {
		path    string
		modTime int64
	}
	cacheFiles := make([]cacheFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr == nil {
			cacheFiles = append(cacheFiles, cacheFile{path: filepath.Join(cacheDirectory, entry.Name()), modTime: info.ModTime().UnixNano()})
		}
	}
	sort.Slice(cacheFiles, func(left int, right int) bool { return cacheFiles[left].modTime < cacheFiles[right].modTime })
	for len(cacheFiles) > maxFiles {
		_ = os.Remove(cacheFiles[0].path)
		cacheFiles = cacheFiles[1:]
	}
}

func openEntryReader(operationCtx context.Context, entry ImageEntry) (io.ReadCloser, error) {
	if err := checkOperation(operationCtx); err != nil {
		return nil, err
	}
	if entry.Source == "file" {
		file, err := os.Open(entry.Path)
		if err != nil {
			return nil, err
		}
		return &combinedReadCloser{Reader: &contextReader{ctx: operationCtx, reader: file}, closers: []io.Closer{file}}, nil
	}
	if normalizedExtension(entry.ArchivePath) == ".zip" {
		return openZipEntryReader(operationCtx, entry)
	}
	return openTarEntryReader(operationCtx, entry)
}

func openZipEntryReader(operationCtx context.Context, entry ImageEntry) (io.ReadCloser, error) {
	reader, err := zip.OpenReader(entry.ArchivePath)
	if err != nil {
		return nil, err
	}

	for _, file := range reader.File {
		if err := checkOperation(operationCtx); err != nil {
			_ = reader.Close()
			return nil, err
		}
		if strings.Trim(path.Clean(normalizeZipEntryName(file)), "/") != entry.InnerPath {
			continue
		}
		opened, err := file.Open()
		if err != nil {
			_ = reader.Close()
			return nil, err
		}
		return &combinedReadCloser{
			Reader:  &contextReader{ctx: operationCtx, reader: opened},
			closers: []io.Closer{opened, reader},
		}, nil
	}
	_ = reader.Close()
	return nil, fmt.Errorf("壓縮檔內找不到內容: %s", entry.InnerPath)
}

func openTarEntryReader(operationCtx context.Context, entry ImageEntry) (io.ReadCloser, error) {
	file, err := os.Open(entry.ArchivePath)
	if err != nil {
		return nil, err
	}

	source, closeSource, err := tarSourceReader(file, entry.ArchivePath)
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	closers := []io.Closer{}
	if sourceCloser, ok := source.(io.Closer); ok && sourceCloser != file {
		closers = append(closers, sourceCloser)
	}
	closers = append(closers, file)
	_ = closeSource

	reader := tar.NewReader(source)
	for {
		if err := checkOperation(operationCtx); err != nil {
			_ = closeReaders(closers)
			return nil, err
		}
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			_ = closeReaders(closers)
			return nil, err
		}
		if strings.Trim(path.Clean(normalizeArchiveEntryName(header.Name)), "/") == entry.InnerPath {
			return &combinedReadCloser{
				Reader:  &contextReader{ctx: operationCtx, reader: io.LimitReader(reader, header.Size)},
				closers: closers,
			}, nil
		}
	}
	_ = closeReaders(closers)
	return nil, fmt.Errorf("壓縮檔內找不到內容: %s", entry.InnerPath)
}

func tarSourceReader(file *os.File, archivePath string) (io.Reader, func() error, error) {
	lower := strings.ToLower(archivePath)
	if strings.HasSuffix(lower, ".tgz") || strings.HasSuffix(lower, ".tar.gz") {
		gzipReader, err := gzip.NewReader(file)
		if err != nil {
			return nil, nil, err
		}
		return gzipReader, gzipReader.Close, nil
	}
	return file, nil, nil
}

type combinedReadCloser struct {
	io.Reader
	closers []io.Closer
}

func (reader *combinedReadCloser) Close() error {
	return closeReaders(reader.closers)
}

func closeReaders(closers []io.Closer) error {
	var firstErr error
	for _, closer := range closers {
		if closer == nil {
			continue
		}
		if err := closer.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (reader *contextReader) Read(buffer []byte) (int, error) {
	if err := checkOperation(reader.ctx); err != nil {
		return 0, err
	}
	return reader.reader.Read(buffer)
}

func checkOperation(operationCtx context.Context) error {
	select {
	case <-operationCtx.Done():
		return errOperationCancelled
	default:
		return nil
	}
}

func hashEntry(operationCtx context.Context, entry ImageEntry) (string, error) {
	reader, err := openEntryReader(operationCtx, entry)
	if err != nil {
		return "", err
	}
	defer reader.Close()

	hash := sha256.New()
	written, err := io.Copy(hash, io.LimitReader(reader, maxExportBytes+1))
	if err != nil {
		return "", err
	}
	if written > maxExportBytes {
		return "", fmt.Errorf("%s 超過雜湊上限 %d GB", entry.Name, maxExportBytes/1024/1024/1024)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func copyEntryToFile(operationCtx context.Context, entry ImageEntry, destinationPath string) error {
	reader, err := openEntryReader(operationCtx, entry)
	if err != nil {
		return err
	}
	defer reader.Close()

	output, err := os.OpenFile(destinationPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	completed := false
	defer func() {
		_ = output.Close()
		if !completed {
			_ = os.Remove(destinationPath)
		}
	}()

	written, err := io.Copy(output, io.LimitReader(reader, maxExportBytes+1))
	if err != nil {
		return err
	}
	if written > maxExportBytes {
		return fmt.Errorf("%s 超過匯出上限 %d GB", entry.Name, maxExportBytes/1024/1024/1024)
	}
	if err := output.Close(); err != nil {
		return err
	}
	completed = true
	return nil
}

func scaledDimensions(width int, height int, maxDimension int) (int, int) {
	if width <= 0 || height <= 0 || (width <= maxDimension && height <= maxDimension) {
		return width, height
	}
	if width >= height {
		return maxDimension, max(1, height*maxDimension/width)
	}
	return max(1, width*maxDimension/height), maxDimension
}

func uniqueExportName(destination string, originalName string, usedNames map[string]bool) string {
	name := filepath.Base(originalName)
	extension := filepath.Ext(name)
	baseName := strings.TrimSuffix(name, extension)
	for index := 0; ; index++ {
		candidate := name
		if index > 0 {
			candidate = fmt.Sprintf("%s-%d%s", baseName, index+1, extension)
		}
		if usedNames[candidate] {
			continue
		}
		if _, err := os.Stat(filepath.Join(destination, candidate)); errors.Is(err, os.ErrNotExist) {
			return candidate
		}
	}
}

func normalizedExtension(filePath string) string {
	if special := normalizedSpecialFileName(filepath.Base(filePath)); special != "" {
		return special
	}
	lower := strings.ToLower(filePath)
	if strings.HasSuffix(lower, ".tar.gz") {
		return ".tar.gz"
	}
	return strings.ToLower(filepath.Ext(filePath))
}

func normalizedArchiveExtension(filePath string) string {
	if special := normalizedSpecialFileName(path.Base(filePath)); special != "" {
		return special
	}
	return strings.ToLower(path.Ext(filePath))
}

func normalizedSpecialFileName(fileName string) string {
	switch strings.ToLower(strings.TrimSpace(fileName)) {
	case "dockerfile":
		return ".dockerfile"
	case "makefile", "gnumakefile":
		return ".makefile"
	case ".gitignore", ".gitattributes", ".editorconfig", ".npmrc", ".yarnrc":
		return ".config"
	}
	return ""
}

func shouldIgnoreEntryName(fileName string) bool {
	name := strings.TrimSpace(fileName)
	return strings.HasPrefix(name, "._") || name == ".DS_Store"
}

func shouldIgnoreArchiveEntry(entryName string) bool {
	cleanName := strings.Trim(path.Clean(entryName), "/")
	if cleanName == "" || cleanName == "." {
		return true
	}
	for _, part := range strings.Split(cleanName, "/") {
		if shouldIgnoreEntryName(part) || part == "__MACOSX" {
			return true
		}
	}
	return false
}

func splitArchiveImagePath(imagePath string) (string, string, bool) {
	archivePath, innerPath, ok := splitArchiveEntryPath(imagePath)
	if !ok || !isSupportedImage(normalizedArchiveExtension(innerPath)) {
		return "", "", false
	}
	return archivePath, innerPath, true
}

func splitArchiveEntryPath(imagePath string) (string, string, bool) {
	parts := strings.SplitN(imagePath, "::", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	archivePath := strings.TrimSpace(parts[0])
	innerPath := strings.Trim(path.Clean(parts[1]), "/")
	if archivePath == "" || innerPath == "" {
		return "", "", false
	}
	if !isSupportedArchive(normalizedExtension(archivePath)) || !isSupportedEntry(normalizedArchiveExtension(innerPath)) {
		return "", "", false
	}
	return archivePath, innerPath, true
}

func entryKind(extension string) string {
	if extension == ".pdf" {
		return "pdf"
	}
	if extension == ".md" || extension == ".markdown" {
		return "markdown"
	}
	if extension == ".txt" {
		return "text"
	}
	if isSupportedMedia(extension) {
		if isSubtitleExtension(extension) {
			return "subtitle"
		}
		if isVideoExtension(extension) {
			return "video"
		}
		return "audio"
	}
	if isSupportedDocument(extension) {
		return "code"
	}
	return "image"
}

func isSubtitleExtension(extension string) bool {
	switch extension {
	case ".srt", ".vtt", ".ass", ".ssa", ".sub", ".smi":
		return true
	default:
		return false
	}
}

func isVideoExtension(extension string) bool {
	switch extension {
	case ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".m2ts":
		return true
	default:
		return false
	}
}

func isSupportedDocument(extension string) bool {
	for _, supported := range supportedDocumentExtensions {
		if extension == supported {
			return true
		}
	}
	return false
}

func isSupportedEntry(extension string) bool {
	return isSupportedImage(extension) || isSupportedDocument(extension) || isSupportedMedia(extension)
}

func isSupportedMedia(extension string) bool {
	for _, supported := range supportedMediaExtensions {
		if extension == supported {
			return true
		}
	}
	return false
}

func decodeDocumentText(data []byte) string {
	if decoded, ok := decodeUTF16Document(data); ok {
		return normalizeLineEndings(decoded)
	}
	if utf8.Valid(data) {
		return normalizeLineEndings(strings.TrimPrefix(string(data), "\ufeff"))
	}
	type encodingCandidate struct {
		encoding encoding.Encoding
		bias     int
	}
	bestText := string(data)
	bestScore := scoreDecodedDocument(bestText) - 100
	for _, candidate := range []encodingCandidate{
		{encoding: simplifiedchinese.GB18030, bias: 3},
		{encoding: traditionalchinese.Big5, bias: 2},
		{encoding: japanese.ShiftJIS},
		{encoding: charmap.Windows1252, bias: -5},
	} {
		decoded, err := candidate.encoding.NewDecoder().Bytes(data)
		if err != nil || !utf8.Valid(decoded) {
			continue
		}
		text := string(decoded)
		score := scoreDecodedDocument(text) + candidate.bias
		if score > bestScore {
			bestText = text
			bestScore = score
		}
	}
	return normalizeLineEndings(bestText)
}

func normalizeLineEndings(text string) string {
	return strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
}

func scoreDecodedDocument(text string) int {
	score := 0
	for _, value := range text {
		switch {
		case value == utf8.RuneError:
			score -= 100
		case value < 0x20 && value != '\n' && value != '\r' && value != '\t':
			score -= 50
		case value >= 0x3040 && value <= 0x30ff:
			score += 8
		case isCJKRune(value):
			score += 4
		case value >= 0x20 && value < 0x7f:
			score += 2
		default:
			score++
		}
	}
	return score
}

func binaryDocumentReason(data []byte) string {
	if len(data) >= 4 && data[0] == 0x00 && data[1] == 0x05 && data[2] == 0x16 && data[3] == 0x07 {
		return "這是 macOS AppleDouble 中繼資料"
	}
	if len(data) == 0 {
		return ""
	}
	if hasUTF16ByteOrderMark(data) {
		return ""
	}
	sample := data
	if len(sample) > 8192 {
		sample = sample[:8192]
	}
	controlCount := 0
	for _, value := range sample {
		if value == 0 {
			return "內容包含 NUL 位元"
		}
		if value < 0x09 || (value > 0x0d && value < 0x20) {
			controlCount++
		}
	}
	if controlCount*100 > len(sample)*8 {
		return "內容包含過多控制字元"
	}
	return ""
}

func hasUTF16ByteOrderMark(data []byte) bool {
	return len(data) >= 2 && ((data[0] == 0xff && data[1] == 0xfe) || (data[0] == 0xfe && data[1] == 0xff))
}

func decodeUTF16Document(data []byte) (string, bool) {
	if !hasUTF16ByteOrderMark(data) || len(data)%2 != 0 {
		return "", false
	}
	var byteOrder binary.ByteOrder = binary.LittleEndian
	if data[0] == 0xfe {
		byteOrder = binary.BigEndian
	}
	units := make([]uint16, 0, (len(data)-2)/2)
	for index := 2; index+1 < len(data); index += 2 {
		units = append(units, byteOrder.Uint16(data[index:index+2]))
	}
	return string(utf16.Decode(units)), true
}

func normalizeZipEntryName(file *zip.File) string {
	if !file.NonUTF8 && utf8.ValidString(file.Name) && !strings.ContainsRune(file.Name, utf8.RuneError) {
		return file.Name
	}
	return normalizeArchiveEntryName(file.Name)
}

func normalizeArchiveEntryName(entryName string) string {
	raw := []byte(entryName)
	candidates := []string{}
	if utf8.Valid(raw) {
		candidates = append(candidates, string(raw))
	}
	candidates = appendDecodedCandidate(candidates, raw, simplifiedchinese.GBK)
	candidates = appendDecodedCandidate(candidates, raw, traditionalchinese.Big5)
	candidates = appendDecodedCandidate(candidates, raw, charmap.CodePage437)
	candidates = appendDecodedCandidate(candidates, raw, charmap.Windows1252)

	best := entryName
	bestScore := scoreEntryName(entryName)
	seen := map[string]bool{entryName: true}
	for _, candidate := range candidates {
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true
		score := scoreEntryName(candidate)
		if score > bestScore {
			best = candidate
			bestScore = score
		}
	}
	return best
}

func appendDecodedCandidate(candidates []string, raw []byte, enc encoding.Encoding) []string {
	decoded, err := enc.NewDecoder().String(string(raw))
	if err != nil {
		return candidates
	}
	return append(candidates, decoded)
}

func scoreEntryName(name string) int {
	score := 0
	for _, r := range name {
		switch {
		case r == utf8.RuneError:
			score -= 100
		case r < 0x20 && r != '\t':
			score -= 50
		case isCJKRune(r):
			score += 12
		case r >= 0x20 && r < 0x7f:
			score += 2
		default:
			score += 1
		}
	}
	if strings.Contains(name, "�") {
		score -= 200
	}
	return score
}

func isCJKRune(r rune) bool {
	return (r >= 0x3400 && r <= 0x9fff) ||
		(r >= 0xf900 && r <= 0xfaff) ||
		(r >= 0x3000 && r <= 0x303f) ||
		(r >= 0xff00 && r <= 0xffef)
}

func isSupportedImage(extension string) bool {
	for _, supported := range supportedImageExtensions {
		if extension == supported {
			return true
		}
	}
	return false
}

func newExtensionFilter(enabledExtensions []string, supportedExtensions []string) map[string]bool {
	filter := make(map[string]bool)
	if enabledExtensions == nil {
		for _, extension := range supportedExtensions {
			filter[extension] = true
		}
		return filter
	}

	for _, extension := range enabledExtensions {
		normalized := strings.ToLower(strings.TrimSpace(extension))
		if normalized == "" {
			continue
		}
		if !strings.HasPrefix(normalized, ".") {
			normalized = "." + normalized
		}
		if containsExtension(supportedExtensions, normalized) {
			filter[normalized] = true
		}
	}
	return filter
}

func isEnabledExtension(extension string, filter map[string]bool) bool {
	return filter[extension]
}

func containsExtension(extensions []string, target string) bool {
	for _, extension := range extensions {
		if extension == target {
			return true
		}
	}
	return false
}

func isSupportedArchive(extension string) bool {
	for _, supported := range supportedArchiveExtensions {
		if extension == supported {
			return true
		}
	}
	return false
}

func mimeByExtension(extension string) string {
	switch extension {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".svg":
		return "image/svg+xml"
	case ".tif", ".tiff":
		return "image/tiff"
	case ".heic":
		return "image/heic"
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".mkv":
		return "video/x-matroska"
	case ".avi":
		return "video/x-msvideo"
	case ".m2ts":
		return "video/mp2t"
	case ".mp3", ".mp2":
		return "audio/mpeg"
	case ".m4a", ".m4b":
		return "audio/mp4"
	case ".wav":
		return "audio/wav"
	case ".aac":
		return "audio/aac"
	case ".flac":
		return "audio/flac"
	case ".ogg", ".oga":
		return "audio/ogg"
	case ".opus":
		return "audio/opus"
	case ".aif", ".aiff", ".aifc":
		return "audio/aiff"
	case ".caf":
		return "audio/x-caf"
	case ".wma":
		return "audio/x-ms-wma"
	case ".ape":
		return "audio/ape"
	case ".wv":
		return "audio/wavpack"
	case ".alac":
		return "audio/alac"
	case ".ac3":
		return "audio/ac3"
	case ".amr":
		return "audio/amr"
	case ".mka":
		return "audio/x-matroska"
	case ".vtt":
		return "text/vtt"
	case ".srt", ".ass", ".ssa", ".sub", ".smi":
		return "text/plain"
	default:
		return "application/octet-stream"
	}
}

func currentHardwareInfo() string {
	cpuName := currentCPUName()
	if cpuName == "" {
		cpuName = runtime.GOARCH
	}
	cpuText := fmt.Sprintf("%s (%d CPU)", cpuName, runtime.NumCPU())
	ramText := formatMemoryBytes(currentTotalMemoryBytes())
	if ramText == "" {
		return cpuText
	}
	return cpuText + " / RAM " + ramText
}

func currentCPUName() string {
	switch runtime.GOOS {
	case "darwin":
		if value := runCommand("sysctl", "-n", "machdep.cpu.brand_string"); value != "" {
			return value
		}
		if value := runCommand("sysctl", "-n", "hw.model"); value != "" {
			return value
		}
	case "linux":
		if value := readLinuxCPUModel(); value != "" {
			return value
		}
	case "windows":
		if value := runCommand("powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)"); value != "" {
			return value
		}
	}
	return ""
}

func currentTotalMemoryBytes() uint64 {
	switch runtime.GOOS {
	case "darwin":
		if value := runCommand("sysctl", "-n", "hw.memsize"); value != "" {
			return parseUint(value)
		}
	case "linux":
		return readLinuxMemoryBytes()
	case "windows":
		if value := runCommand("powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"); value != "" {
			return parseUint(value)
		}
	}
	return 0
}

func currentOSVersion() string {
	switch runtime.GOOS {
	case "darwin":
		productName := runCommand("sw_vers", "-productName")
		productVersion := runCommand("sw_vers", "-productVersion")
		buildVersion := runCommand("sw_vers", "-buildVersion")
		return joinNonEmpty(" ", productName, productVersion, buildVersion)
	case "linux":
		if value := readLinuxPrettyName(); value != "" {
			return value
		}
	case "windows":
		if value := runCommand("powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).Version"); value != "" {
			return value
		}
		if value := runCommand("cmd", "/C", "ver"); value != "" {
			return value
		}
	}
	return runtime.GOOS + "/" + runtime.GOARCH
}

func readLinuxCPUModel() string {
	data, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if ok && strings.TrimSpace(key) == "model name" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func readLinuxMemoryBytes() uint64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == "MemTotal:" {
			return parseUint(fields[1]) * 1024
		}
	}
	return 0
}

func readLinuxPrettyName() string {
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok && key == "PRETTY_NAME" {
			return strings.Trim(strings.TrimSpace(value), `"`)
		}
	}
	return ""
}

func runCommand(name string, args ...string) string {
	output, err := exec.Command(name, args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func parseUint(value string) uint64 {
	parsed, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func formatMemoryBytes(bytes uint64) string {
	if bytes == 0 {
		return ""
	}
	const gib = 1024 * 1024 * 1024
	return fmt.Sprintf("%.1f GB", float64(bytes)/gib)
}

func joinNonEmpty(separator string, values ...string) string {
	parts := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			parts = append(parts, value)
		}
	}
	return strings.Join(parts, separator)
}

func kindRank(kind string) int {
	switch kind {
	case "directory":
		return 0
	case "archive":
		return 1
	default:
		return 9
	}
}

func displayName(targetPath string) string {
	name := filepath.Base(targetPath)
	if name == "." || name == string(filepath.Separator) {
		return targetPath
	}
	return name
}

func nodeID(targetPath string) string {
	return hashID("node", targetPath)
}

func hashID(parts ...string) string {
	hash := sha1.New()
	for _, part := range parts {
		_, _ = hash.Write([]byte(part))
		_, _ = hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}
