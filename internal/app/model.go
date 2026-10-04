package app

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

const modelURLPrefix = "/model/"
const maxModelResourceBytes = 128 * 1024 * 1024

// Only model data and texture formats can be read relative to a selected model.
// Documents, scripts and arbitrary local URLs are never served by this endpoint.
func isModelResource(name string) bool {
	ext := strings.ToLower(path.Ext(name))
	if isSupportedModel(ext) {
		return true
	}
	switch ext {
	case ".bin", ".mtl", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".tga":
		return true
	}
	return false
}

func validModelResourcePath(name string) bool {
	if name == "" || strings.ContainsAny(name, "\\\x00:") || strings.HasPrefix(name, "/") || !isModelResource(name) {
		return false
	}
	for _, segment := range strings.Split(name, "/") {
		if segment == "" || segment == "." || segment == ".." || strings.HasPrefix(segment, ".") || shouldIgnoreEntryName(segment) {
			return false
		}
	}
	return true
}

// PrepareModelByPath registers the selected model without copying it over the
// Wails bridge. Dependencies are restricted to its directory and descendants.
func (s *MediaService) PrepareModelByPath(filePath string) (string, error) {
	entry, err := entryByPath(filePath)
	if err != nil {
		return "", err
	}
	if entry.Kind != "model" || !validModelResourcePath(entry.Name) || (entry.Source == "archive" && !validModelResourcePath(entry.InnerPath)) {
		return "", fmt.Errorf("不是支援的 3D 檔案")
	}
	if entry.Size > maxModelResourceBytes {
		return "", fmt.Errorf("3D 檔案超過 %d MB 上限", maxModelResourceBytes/1024/1024)
	}
	s.entries.remember(entry)
	return modelURLPrefix + url.PathEscape(entry.ID) + "/" + url.PathEscape(entry.Name), nil
}

var archiveModelSlots = make(chan struct{}, 2)

func (s *MediaService) serveModel(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		http.Error(response, "不支援的要求方法", http.StatusMethodNotAllowed)
		return
	}
	id, name, ok := strings.Cut(strings.TrimPrefix(request.URL.Path, modelURLPrefix), "/")
	entry, registered := s.entries.lookup(id)
	if !ok || !registered || entry.Kind != "model" || !validModelResourcePath(name) {
		http.NotFound(response, request)
		return
	}
	response.Header().Set("Content-Type", "application/octet-stream")
	response.Header().Set("Cache-Control", "private, no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	response.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	if entry.Source == "file" {
		root, err := os.OpenRoot(filepath.Dir(entry.Path))
		if err != nil {
			http.NotFound(response, request)
			return
		}
		defer root.Close()
		// Root.Open prevents traversal through symlinks. Nonblocking open also
		// prevents a replaced resource/FIFO from blocking the HTTP handler.
		file, err := openRootFileWithoutBlocking(root, filepath.FromSlash(name))
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
		if info.Size() > maxModelResourceBytes {
			http.Error(response, "3D 資源超過大小上限", http.StatusRequestEntityTooLarge)
			return
		}
		http.ServeContent(response, request, name, info.ModTime(), io.NewSectionReader(file, 0, info.Size()))
		return
	}
	if entry.Source != "archive" {
		http.NotFound(response, request)
		return
	}
	select {
	case archiveModelSlots <- struct{}{}:
		defer func() { <-archiveModelSlots }()
	case <-request.Context().Done():
		return
	}
	resource := buildArchiveImageEntry(entry.ArchivePath, path.Join(path.Dir(entry.InnerPath), name), 0)
	data, err := readEntryLimitedWithContext(request.Context(), resource, maxModelResourceBytes)
	if err != nil {
		http.NotFound(response, request)
		return
	}
	http.ServeContent(response, request, name, time.Time{}, bytes.NewReader(data))
}
