package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const mediaURLPrefix = "/media/"

var findFFmpegExecutable = findFFmpeg

// NewMediaMiddleware 會在內嵌資產或開發伺服器之前處理媒體要求。
func NewMediaMiddleware(application *App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			if strings.HasPrefix(request.URL.Path, mediaURLPrefix) {
				application.serveMedia(response, request)
				return
			}
			next.ServeHTTP(response, request)
		})
	}
}

// CleanupMediaCache 會移除為壓縮檔跳轉播放所解出的暫存檔案。
func CleanupMediaCache(application *App) {
	if application != nil {
		application.cleanupMediaCache()
	}
}

// PrepareMediaByPath 會註冊已驗證的媒體項目，並回傳本機串流網址。
func (a *App) PrepareMediaByPath(filePath string) (string, error) {
	entry, err := entryByPath(filePath)
	if err != nil {
		return "", err
	}
	if entry.Kind != "video" && entry.Kind != "audio" {
		return "", fmt.Errorf("不是支援的影音檔案: %s", entry.Name)
	}
	if entry.Kind == "audio" && requiresAudioCompatibility(entry.Format) {
		return a.prepareCompatibleAudio(entry)
	}
	if strings.EqualFold(entry.Format, ".mkv") {
		if _, err := findFFmpegExecutable(); err != nil {
			return "", fmt.Errorf("播放 MKV 需要 ffmpeg；請先執行 brew install ffmpeg: %w", err)
		}
		if _, err := a.seekableMediaPath(entry); err != nil {
			return "", err
		}
	}
	a.rememberImage(entry)
	return mediaURLPrefix + url.PathEscape(entry.ID), nil
}

// PrepareCompatibleMediaByPath 會在 WebKit 無法解碼原始音訊時建立通用 M4A 暫存檔。
func (a *App) PrepareCompatibleMediaByPath(filePath string) (string, error) {
	entry, err := entryByPath(filePath)
	if err != nil {
		return "", err
	}
	if entry.Kind != "audio" {
		return "", fmt.Errorf("不是支援的音訊檔案: %s", entry.Name)
	}
	return a.prepareCompatibleAudio(entry)
}

func (a *App) prepareCompatibleAudio(entry ImageEntry) (string, error) {
	playablePath, err := a.compatibleAudioPath(entry)
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
	a.rememberImage(compatibleEntry)
	return mediaURLPrefix + url.PathEscape(compatibleEntry.ID), nil
}

func (a *App) serveMedia(response http.ResponseWriter, request *http.Request) {
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

	a.imageMu.Lock()
	entry, ok := a.lastImages[entryID]
	a.imageMu.Unlock()
	if !ok || (entry.Kind != "video" && entry.Kind != "audio") {
		http.NotFound(response, request)
		return
	}

	mediaPath, err := a.seekableMediaPath(entry)
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

func (a *App) seekableMediaPath(entry ImageEntry) (string, error) {
	if entry.Source != "archive" && !strings.EqualFold(entry.Format, ".mkv") {
		return entry.Path, nil
	}

	a.mediaCacheMu.Lock()
	defer a.mediaCacheMu.Unlock()
	if cachedPath := a.mediaCacheFiles[entry.ID]; cachedPath != "" {
		if info, err := os.Stat(cachedPath); err == nil && info.Mode().IsRegular() {
			return cachedPath, nil
		}
		delete(a.mediaCacheFiles, entry.ID)
	}
	if a.mediaCacheDir == "" {
		cacheDirectory, err := os.MkdirTemp("", "fastfileviewer-media-")
		if err != nil {
			return "", fmt.Errorf("建立媒體暫存目錄失敗: %w", err)
		}
		a.mediaCacheDir = cacheDirectory
	}

	sourcePath := entry.Path
	removeSource := false
	if entry.Source == "archive" {
		extractedPath, err := a.extractMediaEntry(entry)
		if err != nil {
			return "", err
		}
		sourcePath = extractedPath
		removeSource = strings.EqualFold(entry.Format, ".mkv")
	}
	if strings.EqualFold(entry.Format, ".mkv") {
		playablePath, err := a.convertMKVToMP4(sourcePath, entry.ID)
		if removeSource {
			_ = os.Remove(sourcePath)
		}
		if err != nil {
			return "", err
		}
		a.mediaCacheFiles[entry.ID] = playablePath
		return playablePath, nil
	}
	a.mediaCacheFiles[entry.ID] = sourcePath
	return sourcePath, nil
}

func (a *App) extractMediaEntry(entry ImageEntry) (string, error) {
	reader, err := openEntryReader(context.Background(), entry)
	if err != nil {
		return "", fmt.Errorf("讀取壓縮檔媒體失敗: %w", err)
	}
	defer reader.Close()
	temporary, err := os.CreateTemp(a.mediaCacheDir, entry.ID+"-*.part")
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
	finalPath := filepath.Join(a.mediaCacheDir, entry.ID+entry.Format)
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return "", fmt.Errorf("完成媒體暫存檔失敗: %w", err)
	}
	completed = true
	return finalPath, nil
}

func (a *App) compatibleAudioPath(entry ImageEntry) (string, error) {
	a.mediaCacheMu.Lock()
	defer a.mediaCacheMu.Unlock()
	cacheKey := entry.ID + "-compatible-audio"
	if cachedPath := a.mediaCacheFiles[cacheKey]; cachedPath != "" {
		if info, err := os.Stat(cachedPath); err == nil && info.Mode().IsRegular() {
			return cachedPath, nil
		}
		delete(a.mediaCacheFiles, cacheKey)
	}
	if a.mediaCacheDir == "" {
		cacheDirectory, err := os.MkdirTemp("", "fastfileviewer-media-")
		if err != nil {
			return "", fmt.Errorf("建立媒體暫存目錄失敗: %w", err)
		}
		a.mediaCacheDir = cacheDirectory
	}

	sourcePath := entry.Path
	removeSource := false
	if entry.Source == "archive" {
		extractedPath, err := a.extractMediaEntry(entry)
		if err != nil {
			return "", err
		}
		sourcePath = extractedPath
		removeSource = true
	}
	playablePath, err := a.convertAudioToM4A(sourcePath, cacheKey)
	if removeSource {
		_ = os.Remove(sourcePath)
	}
	if err != nil {
		return "", err
	}
	a.mediaCacheFiles[cacheKey] = playablePath
	return playablePath, nil
}

func (a *App) convertAudioToM4A(sourcePath string, cacheKey string) (string, error) {
	ffmpegPath, err := findFFmpegExecutable()
	if err != nil {
		return "", fmt.Errorf("播放此音訊格式需要 ffmpeg；請先執行 brew install ffmpeg: %w", err)
	}
	finalPath := filepath.Join(a.mediaCacheDir, cacheKey+".m4a")
	temporaryPath := finalPath + ".part"
	_ = os.Remove(temporaryPath)
	defer os.Remove(temporaryPath)

	command := exec.Command(ffmpegPath,
		"-v", "error", "-nostdin", "-y", "-i", sourcePath,
		"-map", "0:a:0?", "-map_metadata", "0", "-vn",
		"-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-f", "mp4", temporaryPath,
	)
	if output, commandErr := command.CombinedOutput(); commandErr != nil {
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

func (a *App) convertMKVToMP4(sourcePath string, entryID string) (string, error) {
	ffmpegPath, err := findFFmpegExecutable()
	if err != nil {
		return "", err
	}
	finalPath := filepath.Join(a.mediaCacheDir, entryID+".mp4")
	temporaryPath := finalPath + ".part"
	_ = os.Remove(temporaryPath)
	defer os.Remove(temporaryPath)

	remux := exec.Command(ffmpegPath,
		"-v", "error", "-nostdin", "-y", "-i", sourcePath,
		"-map", "0:v:0?", "-map", "0:a:0?", "-map_metadata", "0",
		"-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", "-f", "mp4", temporaryPath,
	)
	if output, remuxErr := remux.CombinedOutput(); remuxErr != nil {
		_ = os.Remove(temporaryPath)
		transcode := exec.Command(ffmpegPath,
			"-v", "error", "-nostdin", "-y", "-i", sourcePath,
			"-map", "0:v:0?", "-map", "0:a:0?", "-map_metadata", "0",
			"-c:v", "h264_videotoolbox", "-b:v", "8M", "-c:a", "aac",
			"-movflags", "+faststart", "-f", "mp4", temporaryPath,
		)
		if transcodeOutput, transcodeErr := transcode.CombinedOutput(); transcodeErr != nil {
			message := strings.TrimSpace(string(transcodeOutput))
			if message == "" {
				message = strings.TrimSpace(string(output))
			}
			if len(message) > 600 {
				message = message[:600]
			}
			if message == "" {
				message = "ffmpeg did not produce a playable MP4"
			}
			return "", fmt.Errorf("MKV 轉換失敗: %s", message)
		}
	}
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return "", fmt.Errorf("完成 MKV 播放快取失敗: %w", err)
	}
	return finalPath, nil
}

func findFFmpeg() (string, error) {
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

func (a *App) cleanupMediaCache() {
	a.mediaCacheMu.Lock()
	cacheDirectory := a.mediaCacheDir
	a.mediaCacheDir = ""
	a.mediaCacheFiles = make(map[string]string)
	a.mediaCacheMu.Unlock()
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
