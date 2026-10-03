package app

import (
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// serveDocument 僅服務已由 PrepareDocumentByPath 註冊的 PDF，避免 URL 被用來讀取任意本機檔案。
func (s *MediaService) serveDocument(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		http.Error(response, "不支援的要求方法", http.StatusMethodNotAllowed)
		return
	}

	encodedID := strings.TrimPrefix(request.URL.Path, documentURLPrefix)
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
	if !ok || entry.Kind != "pdf" {
		http.NotFound(response, request)
		return
	}

	file, _, err := s.openMediaFile(request.Context(), entry)
	if err != nil {
		if os.IsNotExist(err) || errors.Is(err, errNotRegularFile) {
			http.NotFound(response, request)
		} else {
			http.Error(response, err.Error(), http.StatusInternalServerError)
		}
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(response, request)
		return
	}
	if info.Size() > maxExportBytes {
		http.Error(response, "PDF 超過預覽大小上限", http.StatusRequestEntityTooLarge)
		return
	}

	response.Header().Set("Content-Type", "application/pdf")
	response.Header().Set("Cache-Control", "private, no-store")
	response.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(response, request, filepath.Base(entry.Name), info.ModTime(), file)
}
