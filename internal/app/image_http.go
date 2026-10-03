package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const imageURLPrefix = "/image/"

// 原圖改由本機端點傳輸，避免跨橋接複製完整 Base64 字串。
func (a *App) prepareImagePayload(ctx context.Context, entry ImageEntry) (ImagePayload, error) {
	if err := checkOperation(ctx); err != nil {
		return ImagePayload{}, err
	}
	if entry.Kind != "image" {
		return ImagePayload{}, fmt.Errorf("不是支援的圖片: %s", entry.Name)
	}
	source := entry.Path
	if entry.Source == "archive" {
		source = entry.ArchivePath
	}
	info, err := os.Stat(source)
	if err != nil {
		return ImagePayload{}, err
	}
	if !info.Mode().IsRegular() {
		return ImagePayload{}, fmt.Errorf("不是有效檔案: %s", entry.Name)
	}
	if entry.Source == "file" {
		file, err := openRegularFile(source)
		if err != nil {
			return ImagePayload{}, err
		}
		defer file.Close()
		info, err = file.Stat()
		if err != nil {
			return ImagePayload{}, err
		}
		if err := validateImageReader(entry, &contextReader{ctx: ctx, reader: file}, info.Size()); err != nil {
			return ImagePayload{}, err
		}
	}
	if err := checkOperation(ctx); err != nil {
		return ImagePayload{}, err
	}
	a.rememberImage(entry)
	payload := imagePayloadFromData(entry, nil)
	payload.DataURI = imageURLPrefix + url.PathEscape(entry.ID) + "?v=" + imageSourceVersion(info)
	return payload, nil
}

// Keep the browser URL and HTTP validator consistent with the source identity
// used by thumbnail/archive caches, including edits that preserve size and mtime.
func imageSourceVersion(info os.FileInfo) string {
	fingerprint := fmt.Sprintf("%d\x00%d\x00%s", info.ModTime().UnixNano(), info.Size(), thumbnailFileIdentity(info))
	digest := sha256.Sum256([]byte(fingerprint))
	return fmt.Sprintf("%x", digest[:16])
}

func validateImageReader(entry ImageEntry, reader io.Reader, size int64) error {
	if size < 0 || size > maxImageBytes {
		return fmt.Errorf("圖片超過 %d MB 上限", maxImageBytes/(1024*1024))
	}
	if entry.Format == ".svg" || entry.Format == ".heic" {
		return nil
	}
	config, _, err := image.DecodeConfig(io.LimitReader(reader, maxImageBytes+1))
	if err != nil {
		return fmt.Errorf("無法讀取 %s: %w", entry.Name, err)
	}
	return validateImageDimensions(config.Width, config.Height)
}

// 壓縮檔回應暫時需要完整資料才能驗證；限制並行避免快速切圖堆積緩衝區。
var archiveImageSlots = make(chan struct{}, 2)

func (s *MediaService) serveImage(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		http.Error(response, "不支援的要求方法", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimPrefix(request.URL.Path, imageURLPrefix)
	entry, ok := s.entries.lookup(id)
	if !ok || entry.Kind != "image" {
		http.NotFound(response, request)
		return
	}
	response.Header().Set("Content-Type", mimeByExtension(entry.Format))
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
	response.Header().Set("Cache-Control", "private, no-cache")
	if entry.Source == "file" {
		file, err := openRegularFile(entry.Path)
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
		if err := validateImageReader(entry, &contextReader{ctx: request.Context(), reader: file}, info.Size()); err != nil {
			http.Error(response, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			http.Error(response, err.Error(), http.StatusInternalServerError)
			return
		}
		response.Header().Set("ETag", fmt.Sprintf(`"%s"`, imageSourceVersion(info)))
		http.ServeContent(response, request, entry.Name, info.ModTime(), file)
		return
	}
	archiveInfo, err := os.Stat(entry.ArchivePath)
	if err != nil || !archiveInfo.Mode().IsRegular() {
		http.NotFound(response, request)
		return
	}
	etag := fmt.Sprintf(`"%s-%s"`, entry.ID, imageSourceVersion(archiveInfo))
	response.Header().Set("ETag", etag)
	// 切回同一張圖片時讓瀏覽器重用內容，避免重新解壓再回應 304。
	if request.Header.Get("If-None-Match") == etag {
		response.WriteHeader(http.StatusNotModified)
		return
	}
	select {
	case archiveImageSlots <- struct{}{}:
		defer func() { <-archiveImageSlots }()
	case <-request.Context().Done():
		return
	}
	data, err := readEntryLimitedWithContext(request.Context(), entry, maxImageBytes)
	if err == nil {
		err = validateImageData(entry, data)
	}
	if err != nil {
		http.Error(response, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	http.ServeContent(response, request, entry.Name, time.Time{}, bytes.NewReader(data))
}
