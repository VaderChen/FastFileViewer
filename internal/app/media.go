package app

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const mediaURLPrefix = "/media/"

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
	a.rememberImage(entry)
	return mediaURLPrefix + url.PathEscape(entry.ID), nil
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

	response.Header().Set("Content-Type", mediaMIMEByExtension(entry.Format))
	response.Header().Set("Cache-Control", "private, no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(response, request, entry.Name, info.ModTime(), file)
}

func (a *App) seekableMediaPath(entry ImageEntry) (string, error) {
	if entry.Source != "archive" {
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
	a.mediaCacheFiles[entry.ID] = finalPath
	return finalPath, nil
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
	case ".mp3":
		return "audio/mpeg"
	case ".m4a":
		return "audio/mp4"
	case ".wav":
		return "audio/wav"
	case ".aac":
		return "audio/aac"
	case ".flac":
		return "audio/flac"
	case ".ogg", ".oga", ".opus":
		return "audio/ogg"
	default:
		return "application/octet-stream"
	}
}
