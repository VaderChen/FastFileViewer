package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const mediaURLPrefix = "/media/"
const documentURLPrefix = "/document/"

var (
	findFFmpegExecutable  = findFFmpeg
	findFFprobeExecutable = findFFprobe
	probeMediaCodecsFunc  = probeMediaCodecs
)

// NewMediaMiddleware 會在內嵌資產或開發伺服器之前處理媒體要求。
func NewMediaMiddleware(service *MediaService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			if strings.HasPrefix(request.URL.Path, mediaURLPrefix) {
				service.serveMedia(response, request)
				return
			}
			if strings.HasPrefix(request.URL.Path, documentURLPrefix) {
				service.serveDocument(response, request)
				return
			}
			next.ServeHTTP(response, request)
		})
	}
}

// MediaService 負責影音播放前的準備工作：壓縮檔解壓、改封裝與播放快取。
type MediaService struct {
	ctx        context.Context
	entries    *entryRegistry
	operations *operationRegistry
	// cacheMu 只保護下列快取索引，實際的解壓與轉檔改用 per-entry 鎖。
	cacheMu    sync.Mutex
	cacheDir   string
	cacheFiles map[string]string
	// remuxPrompted 記錄已經詢問過是否清除原始影片的項目，避免重複打擾。
	remuxPrompted map[string]bool
	// prepareMu 只保護 prepareLocks，讓不同影音不會互相等待。
	prepareMu    sync.Mutex
	prepareLocks map[string]*mediaPrepareLock
}

func newMediaService(entries *entryRegistry, operations *operationRegistry) *MediaService {
	return &MediaService{
		entries:       entries,
		operations:    operations,
		cacheFiles:    make(map[string]string),
		remuxPrompted: make(map[string]bool),
		prepareLocks:  make(map[string]*mediaPrepareLock),
	}
}

func (s *MediaService) Startup(ctx context.Context) {
	s.ctx = ctx
}

// PrepareMediaByPath 會註冊已驗證的媒體項目，並回傳本機串流網址。
func (s *MediaService) PrepareMediaByPath(filePath string, operationID int64) (string, error) {
	entry, err := entryByPath(filePath)
	if err != nil {
		return "", err
	}
	if entry.Kind != "video" && entry.Kind != "audio" {
		return "", fmt.Errorf("不是支援的影音檔案: %s", entry.Name)
	}
	operationCtx := s.operations.context(operationID)
	if entry.Kind == "audio" && requiresAudioCompatibility(entry.Format) {
		return s.prepareCompatibleAudio(operationCtx, entry)
	}
	if requiresVideoRemux(entry.Format) {
		if _, err := findFFmpegExecutable(); err != nil {
			return "", fmt.Errorf("播放 %s 需要 ffmpeg；請先執行 brew install ffmpeg: %w", displayFormat(entry.Format), err)
		}
	}
	// 需要解壓或改封裝的項目先在這裡備妥，播放時的 range 要求就不會再觸發長時間工作。
	if entry.Source == "archive" || requiresVideoRemux(entry.Format) {
		if _, err := s.seekableMediaPath(operationCtx, entry); err != nil {
			return "", err
		}
	}
	s.entries.remember(entry)
	return mediaURLPrefix + url.PathEscape(entry.ID), nil
}

// PrepareDocumentByPath 會註冊已驗證的 PDF 項目，並回傳本機串流網址。
// 壓縮檔內的 PDF 會先解壓到媒體暫存目錄，關閉應用程式時由既有清理流程移除。
func (s *MediaService) PrepareDocumentByPath(filePath string, operationID int64) (string, error) {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" {
		return "", errors.New("文件路徑不可空白")
	}
	entry, err := entryByPath(filePath)
	if err != nil {
		return "", err
	}
	if entry.Kind != "pdf" {
		return "", fmt.Errorf("不是支援的 PDF 文件: %s", entry.Name)
	}
	if entry.Source == "archive" {
		if _, err := s.seekableMediaPath(s.operations.context(operationID), entry); err != nil {
			return "", err
		}
	} else {
		info, err := os.Stat(entry.Path)
		if err != nil || !info.Mode().IsRegular() {
			return "", fmt.Errorf("讀取 PDF 失敗: %w", err)
		}
		if info.Size() > maxExportBytes {
			return "", fmt.Errorf("%s 超過預覽上限 %d GB", entry.Name, maxExportBytes/(1024*1024*1024))
		}
		entry.Size = info.Size()
	}
	s.entries.remember(entry)
	return documentURLPrefix + url.PathEscape(entry.ID), nil
}

// PrepareCompatibleMediaByPath 會在 WebKit 無法解碼原始音訊時建立通用 M4A 暫存檔。
func (s *MediaService) PrepareCompatibleMediaByPath(filePath string, operationID int64) (string, error) {
	entry, err := entryByPath(filePath)
	if err != nil {
		return "", err
	}
	if entry.Kind != "audio" {
		return "", fmt.Errorf("不是支援的音訊檔案: %s", entry.Name)
	}
	return s.prepareCompatibleAudio(s.operations.context(operationID), entry)
}

func (s *MediaService) prepareCompatibleAudio(operationCtx context.Context, entry ImageEntry) (string, error) {
	playablePath, err := s.compatibleAudioPath(operationCtx, entry)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(playablePath)
	if err != nil {
		return "", fmt.Errorf("讀取相容音訊暫存檔失敗: %w", err)
	}
	compatibleEntry := entry
	compatibleEntry.ID = entry.ID + "-compatible-audio"
	compatibleEntry.Name = strings.TrimSuffix(entry.Name, filepath.Ext(entry.Name)) + ".m4a"
	compatibleEntry.Path = playablePath
	compatibleEntry.DirectoryPath = filepath.Dir(playablePath)
	compatibleEntry.Source = "file"
	compatibleEntry.ArchivePath = ""
	compatibleEntry.InnerPath = ""
	compatibleEntry.Format = ".m4a"
	compatibleEntry.Size = info.Size()
	s.entries.remember(compatibleEntry)
	return mediaURLPrefix + url.PathEscape(compatibleEntry.ID), nil
}

// ReleasePlaybackCache 會在關閉播放器或切換檔案時，移除為了播放而產生的暫存影音，避免長期佔用磁碟空間。
func (s *MediaService) ReleasePlaybackCache(filePath string) error {
	entry, err := entryByPath(filePath)
	if err != nil {
		return err
	}
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	for _, cacheKey := range []string{entry.ID, entry.ID + "-compatible-audio"} {
		cachedPath := s.cacheFiles[cacheKey]
		// 已經搬到原始資料夾保存的檔案不在暫存目錄內，必須保留。
		if !s.isInsideMediaCache(cachedPath) {
			continue
		}
		_ = os.Remove(cachedPath)
		delete(s.cacheFiles, cacheKey)
	}
	return nil
}

// ConfirmRemuxedOriginalCleanup 會詢問是否把改封裝結果保存到原資料夾，並將原始影片移到垃圾桶。
// 回傳保存後的新項目供前端更新清單；ID 為空字串代表沒有任何變更。對話框文字由前端依語系傳入。
func (s *MediaService) ConfirmRemuxedOriginalCleanup(filePath string, title string, message string, confirmLabel string, cancelLabel string) (ImageEntry, error) {
	entry, err := entryByPath(filePath)
	if err != nil {
		return ImageEntry{}, err
	}
	if s.ctx == nil || entry.Source != "file" || !requiresVideoRemux(entry.Format) {
		return ImageEntry{}, nil
	}
	cachedPath, ok := s.claimRemuxPrompt(entry.ID)
	if !ok {
		return ImageEntry{}, nil
	}
	targetPath := filepath.Join(entry.DirectoryPath, strings.TrimSuffix(entry.Name, filepath.Ext(entry.Name))+filepath.Ext(cachedPath))
	// 同名檔案已存在時不覆寫，也不詢問。
	if _, err := os.Stat(targetPath); err == nil {
		return ImageEntry{}, nil
	}
	selection, err := wailsruntime.MessageDialog(s.ctx, wailsruntime.MessageDialogOptions{
		Type:          wailsruntime.QuestionDialog,
		Title:         title,
		Message:       message,
		Buttons:       []string{confirmLabel, cancelLabel},
		DefaultButton: cancelLabel,
		CancelButton:  cancelLabel,
	})
	if err != nil {
		return ImageEntry{}, err
	}
	if selection != confirmLabel {
		return ImageEntry{}, nil
	}
	return s.replaceOriginalWithRemux(entry, cachedPath, targetPath)
}

// replaceOriginalWithRemux 會先確保改封裝結果落在原資料夾，成功後才把原始影片移到垃圾桶。
func (s *MediaService) replaceOriginalWithRemux(entry ImageEntry, cachedPath string, targetPath string) (ImageEntry, error) {
	if err := duplicateFile(cachedPath, targetPath); err != nil {
		return ImageEntry{}, fmt.Errorf("保存改封裝結果失敗: %w", err)
	}
	if err := moveToTrash(entry.Path); err != nil {
		_ = os.Remove(targetPath)
		return ImageEntry{}, fmt.Errorf("將原始影片移到垃圾桶失敗: %w", err)
	}
	// 播放中的請求仍指向舊項目，快取索引必須改指到保存後的檔案。
	s.cacheMu.Lock()
	s.cacheFiles[entry.ID] = targetPath
	s.cacheMu.Unlock()
	_ = os.Remove(cachedPath)

	info, err := os.Stat(targetPath)
	if err != nil {
		return ImageEntry{}, fmt.Errorf("讀取保存後的影片失敗: %w", err)
	}
	replacement := buildFileImageEntry(targetPath, info.Size())
	s.entries.remember(replacement)
	return replacement, nil
}

// claimRemuxPrompt 取得仍在暫存目錄內的播放快取，並確保每個項目只詢問一次。
func (s *MediaService) claimRemuxPrompt(entryID string) (string, bool) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	cachedPath := s.cacheFiles[entryID]
	if s.remuxPrompted[entryID] || !s.isInsideMediaCache(cachedPath) {
		return "", false
	}
	s.remuxPrompted[entryID] = true
	return cachedPath, true
}

// isInsideMediaCache 需在持有 mediaCacheMu 時呼叫。
func (s *MediaService) isInsideMediaCache(candidatePath string) bool {
	if s.cacheDir == "" || candidatePath == "" {
		return false
	}
	relativePath, err := filepath.Rel(s.cacheDir, candidatePath)
	if err != nil {
		return false
	}
	return relativePath != ".." && !strings.HasPrefix(relativePath, ".."+string(filepath.Separator))
}

func (s *MediaService) serveMedia(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		http.Error(response, "不支援的要求方法", http.StatusMethodNotAllowed)
		return
	}

	encodedID := strings.TrimPrefix(request.URL.Path, mediaURLPrefix)
	if encodedID == "" || strings.Contains(encodedID, "/") {
		http.NotFound(response, request)
		return
	}
	entryID, err := url.PathUnescape(encodedID)
	if err != nil {
		http.NotFound(response, request)
		return
	}

	entry, ok := s.entries.lookup(entryID)
	if !ok || (entry.Kind != "video" && entry.Kind != "audio") {
		http.NotFound(response, request)
		return
	}

	mediaPath, err := s.seekableMediaPath(request.Context(), entry)
	if err != nil {
		http.Error(response, err.Error(), http.StatusInternalServerError)
		return
	}
	file, err := os.Open(mediaPath)
	if err != nil {
		http.NotFound(response, request)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(response, request)
		return
	}

	response.Header().Set("Content-Type", mediaMIMEByExtension(filepath.Ext(mediaPath)))
	response.Header().Set("Cache-Control", "private, no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(response, request, entry.Name, info.ModTime(), file)
}

func (s *MediaService) seekableMediaPath(operationCtx context.Context, entry ImageEntry) (string, error) {
	if entry.Source != "archive" && !requiresVideoRemux(entry.Format) {
		return entry.Path, nil
	}
	if cachedPath, ok := s.lookupMediaCache(entry.ID); ok {
		return cachedPath, nil
	}

	// 解壓與改封裝可能耗時數分鐘，只鎖住同一個項目，其他影音仍可同時準備與播放。
	lock := s.acquireMediaPrepareLock(entry.ID)
	defer s.releaseMediaPrepareLock(entry.ID, lock)
	// 等鎖期間可能已由其他要求準備完成。
	if cachedPath, ok := s.lookupMediaCache(entry.ID); ok {
		return cachedPath, nil
	}
	if err := checkOperation(operationCtx); err != nil {
		return "", err
	}
	cacheDirectory, err := s.ensureMediaCacheDir()
	if err != nil {
		return "", err
	}

	sourcePath := entry.Path
	removeSource := false
	if entry.Source == "archive" {
		extractedPath, err := s.extractMediaEntry(operationCtx, entry, cacheDirectory)
		if err != nil {
			return "", err
		}
		sourcePath = extractedPath
		removeSource = requiresVideoRemux(entry.Format)
	}
	if requiresVideoRemux(entry.Format) {
		playablePath, err := s.remuxToPlayableContainer(operationCtx, sourcePath, entry.ID, cacheDirectory)
		if removeSource {
			_ = os.Remove(sourcePath)
		}
		if err != nil {
			return "", err
		}
		s.storeMediaCache(entry.ID, playablePath)
		return playablePath, nil
	}
	s.storeMediaCache(entry.ID, sourcePath)
	return sourcePath, nil
}

// mediaPrepareLock 讓同一個項目的準備工作互斥，不同項目則可以並行。
type mediaPrepareLock struct {
	mu      sync.Mutex
	waiters int
}

func (s *MediaService) acquireMediaPrepareLock(cacheKey string) *mediaPrepareLock {
	s.prepareMu.Lock()
	lock := s.prepareLocks[cacheKey]
	if lock == nil {
		lock = &mediaPrepareLock{}
		s.prepareLocks[cacheKey] = lock
	}
	lock.waiters++
	s.prepareMu.Unlock()
	lock.mu.Lock()
	return lock
}

func (s *MediaService) releaseMediaPrepareLock(cacheKey string, lock *mediaPrepareLock) {
	lock.mu.Unlock()
	s.prepareMu.Lock()
	lock.waiters--
	if lock.waiters == 0 {
		delete(s.prepareLocks, cacheKey)
	}
	s.prepareMu.Unlock()
}

func (s *MediaService) lookupMediaCache(cacheKey string) (string, bool) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	cachedPath := s.cacheFiles[cacheKey]
	if cachedPath == "" {
		return "", false
	}
	if info, err := os.Stat(cachedPath); err == nil && info.Mode().IsRegular() {
		return cachedPath, true
	}
	delete(s.cacheFiles, cacheKey)
	return "", false
}

func (s *MediaService) storeMediaCache(cacheKey string, cachedPath string) {
	s.cacheMu.Lock()
	s.cacheFiles[cacheKey] = cachedPath
	s.cacheMu.Unlock()
}

func (s *MediaService) ensureMediaCacheDir() (string, error) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if s.cacheDir == "" {
		cacheDirectory, err := os.MkdirTemp("", "fastfileviewer-media-")
		if err != nil {
			return "", fmt.Errorf("建立媒體暫存目錄失敗: %w", err)
		}
		s.cacheDir = cacheDirectory
	}
	return s.cacheDir, nil
}

func (s *MediaService) extractMediaEntry(operationCtx context.Context, entry ImageEntry, cacheDirectory string) (string, error) {
	reader, err := openEntryReader(operationCtx, entry)
	if err != nil {
		return "", fmt.Errorf("讀取壓縮檔媒體失敗: %w", err)
	}
	defer reader.Close()
	temporary, err := os.CreateTemp(cacheDirectory, entry.ID+"-*.part")
	if err != nil {
		return "", fmt.Errorf("建立媒體暫存檔失敗: %w", err)
	}
	temporaryPath := temporary.Name()
	completed := false
	defer func() {
		_ = temporary.Close()
		if !completed {
			_ = os.Remove(temporaryPath)
		}
	}()
	written, copyErr := io.Copy(temporary, io.LimitReader(reader, maxExportBytes+1))
	if copyErr != nil {
		return "", fmt.Errorf("解壓縮媒體失敗: %w", copyErr)
	}
	if written > maxExportBytes {
		return "", fmt.Errorf("%s 超過播放上限 %d GB", entry.Name, maxExportBytes/1024/1024/1024)
	}
	if err := temporary.Close(); err != nil {
		return "", fmt.Errorf("寫入媒體暫存檔失敗: %w", err)
	}
	finalPath := filepath.Join(cacheDirectory, entry.ID+entry.Format)
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return "", fmt.Errorf("完成媒體暫存檔失敗: %w", err)
	}
	completed = true
	return finalPath, nil
}

func (s *MediaService) compatibleAudioPath(operationCtx context.Context, entry ImageEntry) (string, error) {
	cacheKey := entry.ID + "-compatible-audio"
	if cachedPath, ok := s.lookupMediaCache(cacheKey); ok {
		return cachedPath, nil
	}

	lock := s.acquireMediaPrepareLock(cacheKey)
	defer s.releaseMediaPrepareLock(cacheKey, lock)
	if cachedPath, ok := s.lookupMediaCache(cacheKey); ok {
		return cachedPath, nil
	}
	if err := checkOperation(operationCtx); err != nil {
		return "", err
	}
	cacheDirectory, err := s.ensureMediaCacheDir()
	if err != nil {
		return "", err
	}

	sourcePath := entry.Path
	removeSource := false
	if entry.Source == "archive" {
		extractedPath, err := s.extractMediaEntry(operationCtx, entry, cacheDirectory)
		if err != nil {
			return "", err
		}
		sourcePath = extractedPath
		removeSource = true
	}
	playablePath, err := s.convertAudioToM4A(operationCtx, sourcePath, cacheKey, cacheDirectory)
	if removeSource {
		_ = os.Remove(sourcePath)
	}
	if err != nil {
		return "", err
	}
	s.storeMediaCache(cacheKey, playablePath)
	return playablePath, nil
}

func (s *MediaService) convertAudioToM4A(operationCtx context.Context, sourcePath string, cacheKey string, cacheDirectory string) (string, error) {
	ffmpegPath, err := findFFmpegExecutable()
	if err != nil {
		return "", fmt.Errorf("播放此音訊格式需要 ffmpeg；請先執行 brew install ffmpeg: %w", err)
	}
	finalPath := filepath.Join(cacheDirectory, cacheKey+".m4a")
	temporaryPath := finalPath + ".part"
	_ = os.Remove(temporaryPath)
	defer os.Remove(temporaryPath)

	command := exec.CommandContext(operationCtx, ffmpegPath,
		"-v", "error", "-nostdin", "-y", "-i", sourcePath,
		"-map", "0:a:0?", "-map_metadata", "0", "-vn",
		"-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-f", "mp4", temporaryPath,
	)
	if output, commandErr := command.CombinedOutput(); commandErr != nil {
		if cancelErr := checkOperation(operationCtx); cancelErr != nil {
			return "", cancelErr
		}
		message := strings.TrimSpace(string(output))
		if len(message) > 600 {
			message = message[:600]
		}
		if message == "" {
			message = commandErr.Error()
		}
		return "", fmt.Errorf("音訊相容轉換失敗: %s", message)
	}
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return "", fmt.Errorf("完成音訊相容暫存檔失敗: %w", err)
	}
	return finalPath, nil
}

func requiresAudioCompatibility(extension string) bool {
	switch strings.ToLower(extension) {
	case ".wma", ".ape", ".wv", ".alac", ".ac3", ".amr", ".mka":
		return true
	default:
		return false
	}
}

// mediaCodecs 記錄來源檔案第一條視訊與音訊軌的編碼名稱。
type mediaCodecs struct {
	video string
	audio string
}

// remuxPlan 描述要把來源改封裝成哪一種可播放容器，以及各軌是否可直接複製。
type remuxPlan struct {
	extension       string
	format          string
	videoCodec      string
	audioCodec      string
	videoTag        string
	transcodesVideo bool
}

// requiresVideoRemux 回報 WebKit 無法直接播放、必須先改封裝的視訊容器。
func requiresVideoRemux(extension string) bool {
	switch strings.ToLower(extension) {
	case ".mkv", ".avi", ".m2ts":
		return true
	default:
		return false
	}
}

func (s *MediaService) remuxToPlayableContainer(operationCtx context.Context, sourcePath string, entryID string, cacheDirectory string) (string, error) {
	ffmpegPath, err := findFFmpegExecutable()
	if err != nil {
		return "", err
	}

	attempts := []remuxPlan{remuxPlanForSource(operationCtx, sourcePath)}
	if !attempts[0].transcodesVideo {
		attempts = append(attempts, transcodeRemuxPlan())
	}
	failureMessage := ""
	for _, attempt := range attempts {
		finalPath := filepath.Join(cacheDirectory, entryID+attempt.extension)
		temporaryPath := finalPath + ".part"
		_ = os.Remove(temporaryPath)

		command := exec.CommandContext(operationCtx, ffmpegPath, remuxArguments(sourcePath, temporaryPath, attempt)...)
		output, commandErr := command.CombinedOutput()
		if commandErr == nil {
			if err := os.Rename(temporaryPath, finalPath); err != nil {
				return "", fmt.Errorf("完成影片播放快取失敗: %w", err)
			}
			return finalPath, nil
		}
		_ = os.Remove(temporaryPath)
		// 被取消時不要再落入耗時的重編碼備援。
		if cancelErr := checkOperation(operationCtx); cancelErr != nil {
			return "", cancelErr
		}
		if message := strings.TrimSpace(string(output)); message != "" {
			failureMessage = message
		} else if failureMessage == "" {
			failureMessage = commandErr.Error()
		}
	}
	if len(failureMessage) > 600 {
		failureMessage = failureMessage[:600]
	}
	if failureMessage == "" {
		failureMessage = "ffmpeg did not produce a playable container"
	}
	return "", fmt.Errorf("影片改封裝失敗: %s", failureMessage)
}

// remuxPlanForSource 依來源編碼挑選容器；無法探測時退回複製畫面、重編音訊的保守做法。
func remuxPlanForSource(operationCtx context.Context, sourcePath string) remuxPlan {
	codecs, err := probeMediaCodecsFunc(operationCtx, sourcePath)
	if err != nil {
		return remuxPlan{extension: ".mp4", format: "mp4", videoCodec: "copy", audioCodec: "aac"}
	}
	return planRemux(codecs)
}

// planRemux 只在 WebKit 無法解碼原始視訊編碼時才重新編碼畫面。
func planRemux(codecs mediaCodecs) remuxPlan {
	switch strings.ToLower(codecs.video) {
	case "h264", "avc1":
		return mp4RemuxPlan(codecs.audio, "")
	case "hevc", "h265":
		// Safari 只認得 hvc1 標籤，ffmpeg 預設會寫成 hev1。
		return mp4RemuxPlan(codecs.audio, "hvc1")
	case "vp8", "vp9", "av1":
		return webmRemuxPlan(codecs.audio)
	default:
		return transcodeRemuxPlan()
	}
}

func mp4RemuxPlan(audioCodec string, videoTag string) remuxPlan {
	plan := remuxPlan{extension: ".mp4", format: "mp4", videoCodec: "copy", audioCodec: "aac", videoTag: videoTag}
	switch strings.ToLower(audioCodec) {
	case "aac", "mp3", "alac", "":
		plan.audioCodec = "copy"
	}
	return plan
}

func webmRemuxPlan(audioCodec string) remuxPlan {
	plan := remuxPlan{extension: ".webm", format: "webm", videoCodec: "copy", audioCodec: "libopus"}
	switch strings.ToLower(audioCodec) {
	case "opus", "vorbis", "":
		plan.audioCodec = "copy"
	}
	return plan
}

func transcodeRemuxPlan() remuxPlan {
	return remuxPlan{extension: ".mp4", format: "mp4", videoCodec: "h264_videotoolbox", audioCodec: "aac", transcodesVideo: true}
}

func remuxArguments(sourcePath string, targetPath string, plan remuxPlan) []string {
	arguments := []string{
		"-v", "error", "-nostdin", "-y", "-fflags", "+genpts", "-i", sourcePath,
		"-map", "0:v:0?", "-map", "0:a:0?", "-map_metadata", "0",
		"-c:v", plan.videoCodec,
	}
	if plan.transcodesVideo {
		arguments = append(arguments, "-b:v", "8M")
	}
	if plan.videoTag != "" {
		arguments = append(arguments, "-tag:v", plan.videoTag)
	}
	arguments = append(arguments, "-c:a", plan.audioCodec)
	if plan.format == "mp4" {
		arguments = append(arguments, "-movflags", "+faststart")
	}
	return append(arguments, "-f", plan.format, targetPath)
}

func probeMediaCodecs(operationCtx context.Context, sourcePath string) (mediaCodecs, error) {
	ffprobePath, err := findFFprobeExecutable()
	if err != nil {
		return mediaCodecs{}, err
	}
	command := exec.CommandContext(operationCtx, ffprobePath,
		"-v", "error", "-print_format", "json",
		"-show_entries", "stream=codec_type,codec_name", sourcePath,
	)
	output, err := command.Output()
	if err != nil {
		return mediaCodecs{}, fmt.Errorf("讀取影片編碼資訊失敗: %w", err)
	}
	return parseProbedCodecs(output)
}

func parseProbedCodecs(payload []byte) (mediaCodecs, error) {
	var probed struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			CodecName string `json:"codec_name"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(payload, &probed); err != nil {
		return mediaCodecs{}, fmt.Errorf("解析影片編碼資訊失敗: %w", err)
	}
	var codecs mediaCodecs
	for _, stream := range probed.Streams {
		switch stream.CodecType {
		case "video":
			if codecs.video == "" {
				codecs.video = stream.CodecName
			}
		case "audio":
			if codecs.audio == "" {
				codecs.audio = stream.CodecName
			}
		}
	}
	if codecs.video == "" {
		return mediaCodecs{}, errors.New("找不到可播放的視訊軌")
	}
	return codecs, nil
}

func displayFormat(extension string) string {
	return strings.ToUpper(strings.TrimPrefix(extension, "."))
}

func findFFprobe() (string, error) {
	if candidate, err := bundledFFmpegTool("ffprobe"); err == nil {
		return candidate, nil
	}
	if ffmpegPath, err := findFFmpegExecutable(); err == nil {
		candidate := filepath.Join(filepath.Dir(ffmpegPath), "ffprobe")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
			return candidate, nil
		}
	}
	if candidate, err := exec.LookPath("ffprobe"); err == nil {
		return candidate, nil
	}
	return "", errors.New("找不到 ffprobe")
}

func findFFmpeg() (string, error) {
	if candidate, err := bundledFFmpegTool("ffmpeg"); err == nil {
		return candidate, nil
	}
	for _, candidate := range []string{"/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
			return candidate, nil
		}
	}
	if candidate, err := exec.LookPath("ffmpeg"); err == nil {
		return candidate, nil
	}
	return "", errors.New("找不到 ffmpeg")
}

// bundledFFmpegTool 只在正式 App Bundle 內尋找工具；開發模式找不到時交給系統路徑處理。
func bundledFFmpegTool(name string) (string, error) {
	if runtime.GOOS != "darwin" {
		return "", errors.New("目前平台沒有內建 FFmpeg")
	}
	executablePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	appContents := filepath.Dir(filepath.Dir(executablePath))
	candidate := filepath.Join(appContents, "Resources", "bin", name)
	info, err := os.Stat(candidate)
	if err != nil || info.IsDir() || info.Mode()&0o111 == 0 {
		return "", errors.New("找不到 App Bundle 內的 FFmpeg 工具")
	}
	return candidate, nil
}

func (s *MediaService) cleanup() {
	s.cacheMu.Lock()
	cacheDirectory := s.cacheDir
	s.cacheDir = ""
	s.cacheFiles = make(map[string]string)
	s.cacheMu.Unlock()
	if cacheDirectory != "" {
		_ = os.RemoveAll(cacheDirectory)
	}
}

func mediaMIMEByExtension(extension string) string {
	switch strings.ToLower(extension) {
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
	case ".ogg", ".oga", ".opus":
		return "audio/ogg"
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
	default:
		return "application/octet-stream"
	}
}
