package app

import (
	"archive/zip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPDFClassification(t *testing.T) {
	if entryKind(".pdf") != "pdf" || !isSupportedDocument(".pdf") || !isSupportedEntry(".pdf") {
		t.Fatalf("PDF 分類或支援清單不正確")
	}
}

func TestDocumentMiddlewareRejectsUnregisteredID(t *testing.T) {
	services := New()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, documentURLPrefix+"missing", nil)
	NewMediaMiddleware(services.Media)(http.NotFoundHandler()).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("未註冊 ID 狀態碼 = %d", recorder.Code)
	}
}

func TestDocumentMiddlewareServesPDFAndArchivePDF(t *testing.T) {
	root := t.TempDir()
	pdfData := []byte("%PDF-1.4\nhello\n%%EOF\n")
	pdfPath := filepath.Join(root, "sample.pdf")
	if err := os.WriteFile(pdfPath, pdfData, 0o600); err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(root, "docs.zip")
	archiveFile, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	zipWriter := zip.NewWriter(archiveFile)
	entryWriter, err := zipWriter.Create("nested/report.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entryWriter.Write(pdfData); err != nil {
		t.Fatal(err)
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := archiveFile.Close(); err != nil {
		t.Fatal(err)
	}

	services := New()
	operationID := services.Library.BeginOperation()
	defer services.Library.FinishOperation(operationID)
	urlPath, err := services.Library.PrepareDocumentByPath(pdfPath, operationID)
	if err != nil {
		t.Fatal(err)
	}
	checkDocumentResponse(t, services.Media, urlPath, pdfData)

	archiveURL, err := services.Library.PrepareDocumentByPath(archivePath+"::nested/report.pdf", operationID)
	if err != nil {
		t.Fatal(err)
	}
	checkDocumentResponse(t, services.Media, archiveURL, pdfData)
}

func checkDocumentResponse(t *testing.T, service *MediaService, path string, expected []byte) {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	NewMediaMiddleware(service)(http.NotFoundHandler()).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("PDF 回應狀態碼 = %d，內容=%s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/pdf") {
		t.Fatalf("Content-Type = %q", got)
	}
	if recorder.Header().Get("Cache-Control") != "private, no-store" || recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("安全標頭缺漏: %#v", recorder.Header())
	}
	body, err := io.ReadAll(recorder.Result().Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != string(expected) {
		t.Fatalf("PDF 內容不符: %q", body)
	}
}
