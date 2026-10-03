package app

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"unicode/utf8"
)

type finalDownloadReader struct {
	cancel context.CancelFunc
}

func (reader finalDownloadReader) Read(buffer []byte) (int, error) {
	reader.cancel()
	return copy(buffer, "last chunk"), io.EOF
}

func TestDownloadCancellationAtFinalReadRemovesPartialFile(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	application := newDownloadTestApp("cancel-final")
	directory := t.TempDir()
	response := &http.Response{
		Request: &http.Request{URL: mustParseDownloadURL(t, "https://example.com/file.txt")},
		Header:  make(http.Header),
	}
	err := application.saveDownloadBody(ctx, "cancel-final", directory, response, "text/plain", finalDownloadReader{cancel}, 10)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("final read cancellation should be returned, got %v", err)
	}
	items, err := os.ReadDir(directory)
	if err != nil || len(items) != 0 {
		t.Fatalf("cancelled download left output: %v, %v", items, err)
	}
	if application.ListDownloads()[0].Path != "" {
		t.Fatal("cancelled download was committed")
	}
}

type finalDownloadData string

func (data finalDownloadData) Read(buffer []byte) (int, error) {
	return copy(buffer, data), io.EOF
}

func TestDownloadCancellationDuringFinalWrite(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	source := finalDownloadData("finished")
	_, err := copyDownloadBody(ctx, io.Discard, source, 100, func(int64) { cancel() })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation while writing should be returned, got %v", err)
	}
}

func TestDownloadCommitCancellationAndCollision(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "download.part")
	if err := os.WriteFile(source, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	name := strings.Repeat("中", 180) + ".txt"
	existing := filepath.Join(directory, sanitizeDownloadName(name))
	if err := os.WriteFile(existing, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := commitDownloadedFileWithContext(ctx, source, directory, name); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation before commit, got %v", err)
	}
	path, err := commitDownloadedFile(source, directory, name)
	if err != nil {
		t.Fatal(err)
	}
	if path == existing || filepath.Dir(path) != directory || len(filepath.Base(path)) > 255 || !utf8.ValidString(path) {
		t.Fatalf("invalid collision filename: %q", path)
	}
	original, err := os.ReadFile(existing)
	if err != nil || string(original) != "original" {
		t.Fatalf("existing download changed: %q, %v", original, err)
	}
	if _, err := os.Stat(source); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("committed temporary file remains: %v", err)
	}
	for _, name := range []string{strings.Repeat("中", 180) + ".mp4", "file." + strings.Repeat("🙂", 200)} {
		got := sanitizeDownloadName(name)
		if len(got) > 180 || !utf8.ValidString(got) {
			t.Fatalf("filename limit used rune count or split UTF-8: %q", got)
		}
	}
}

func TestDownloadCommitWithoutNativeRename(t *testing.T) {
	originalRename := renameFile
	renameFile = func(string, string) error { return syscall.ENOTSUP }
	t.Cleanup(func() { renameFile = originalRename })
	// The repository may itself be on ExFAT, where both exclusive rename and
	// hard links are unsupported. Exercise that real filesystem when present.
	directory, err := os.MkdirTemp(".", ".download-lifecycle-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	source := filepath.Join(directory, "download.part")
	if err := os.WriteFile(source, []byte("complete"), 0o600); err != nil {
		t.Fatal(err)
	}
	path, err := commitDownloadedFile(source, directory, "finished.txt")
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != "complete" {
		t.Fatalf("fallback commit failed: %q, %v", content, err)
	}
}

func TestHLSByteRangesRequireValidPredecessorAndAvoidOverflow(t *testing.T) {
	baseURL := mustParseDownloadURL(t, "https://example.com/index.m3u8")
	for _, content := range []string{
		"#EXT-X-BYTERANGE:3\nmedia.ts\n",
		"#EXT-X-BYTERANGE:3@2\nfirst.ts\n#EXT-X-BYTERANGE:2\nother.ts\n",
		"#EXT-X-BYTERANGE:3@2\nmedia.ts\nmedia.ts\n#EXT-X-BYTERANGE:2\nmedia.ts\n",
		"#EXT-X-BYTERANGE:9223372036854775807@1\nmedia.ts\n",
	} {
		if _, err := parseHLSPlaylist("#EXTM3U\n"+content+"#EXT-X-ENDLIST\n", baseURL); err == nil {
			t.Fatalf("invalid byte range accepted: %q", content)
		}
	}
	playlist, err := parseHLSPlaylist("#EXTM3U\n#EXT-X-BYTERANGE:3@2\nmedia.ts\n#EXT-X-BYTERANGE:2\nmedia.ts\n#EXT-X-ENDLIST\n", baseURL)
	if err != nil || len(playlist.Segments) != 2 || playlist.Segments[1].ByteRange != "bytes=5-6" {
		t.Fatalf("valid consecutive byte ranges changed: %#v, %v", playlist, err)
	}
}

func TestHLSRejectsMismatchedRangeResponses(t *testing.T) {
	for _, test := range []struct {
		name    string
		header  string
		payload string
		valid   bool
	}{
		{"valid", "bytes 2-4/8", "234", true},
		{"wrong offset", "bytes 0-2/8", "012", false},
		{"missing header", "", "234", false},
		{"missing unit", "2-4/8", "234", false},
		{"invalid total", "bytes 2-4/4", "234", false},
		{"short body", "bytes 2-4/8", "23", false},
		{"extra body", "bytes 2-4/8", "2345", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path == "/index.m3u8" {
					_, _ = io.WriteString(writer, "#EXTM3U\n#EXT-X-BYTERANGE:3@2\nmedia.ts\n#EXT-X-ENDLIST\n")
					return
				}
				if request.Header.Get("Range") != "bytes=2-4" {
					t.Errorf("unexpected requested range: %s", request.Header.Get("Range"))
				}
				writer.Header().Set("Content-Range", test.header)
				writer.WriteHeader(http.StatusPartialContent)
				writer.(http.Flusher).Flush() // Exercise actual stream length, without Content-Length.
				_, _ = io.WriteString(writer, test.payload)
			}))
			defer server.Close()
			directory := t.TempDir()
			application := newDownloadTestApp("range")
			err := application.downloadToDirectory(context.Background(), server.Client(), "range", server.URL+"/index.m3u8", directory)
			if (err == nil) != test.valid {
				t.Fatalf("valid=%v, got error %v", test.valid, err)
			}
			item := application.ListDownloads()[0]
			if test.valid {
				content, err := os.ReadFile(item.Path)
				if err != nil || string(content) != "234" {
					t.Fatalf("invalid successful output: %q, %v", content, err)
				}
			} else {
				files, err := os.ReadDir(directory)
				if err != nil || len(files) != 0 || item.Path != "" {
					t.Fatalf("failed HLS left output: %v, %#v, %v", files, item, err)
				}
			}
		})
	}
}

func TestDownloadRejectsUnsolicitedPartialResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Range", "bytes 0-2/100")
		writer.WriteHeader(http.StatusPartialContent)
		_, _ = io.WriteString(writer, "012")
	}))
	defer server.Close()
	application := newDownloadTestApp("partial")
	directory := t.TempDir()
	if err := application.downloadToDirectory(context.Background(), server.Client(), "partial", server.URL+"/movie.mp4", directory); err == nil {
		t.Fatal("unsolicited partial response was saved as a complete download")
	}
	files, err := os.ReadDir(directory)
	if err != nil || len(files) != 0 {
		t.Fatalf("partial response left output: %v, %v", files, err)
	}
}

func TestDownloadHistoryOversizePreservesReadableHistory(t *testing.T) {
	originalConfigDirectory := downloadUserConfigDir
	directory := t.TempDir()
	downloadUserConfigDir = func() (string, error) { return directory, nil }
	t.Cleanup(func() { downloadUserConfigDir = originalConfigDirectory })
	application := newDownloadTestApp("saved")
	if err := application.persistDownloads(); err != nil {
		t.Fatal(err)
	}
	historyPath, err := downloadsHistoryPath()
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(historyPath)
	if err != nil {
		t.Fatal(err)
	}
	application.downloads["saved"].Error = strings.Repeat("x", int(maxDownloadHistoryBytes))
	if err := application.persistDownloads(); err == nil {
		t.Fatal("history larger than the load limit was persisted")
	}
	after, err := os.ReadFile(historyPath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("oversize history replaced the last readable version: %v", err)
	}
	reloaded := newDownloadService()
	reloaded.loadDownloads()
	if len(reloaded.ListDownloads()) != 1 {
		t.Fatal("last readable history was lost")
	}
}

func TestDownloadTaskReleasesItsContext(t *testing.T) {
	originalConfigDirectory, originalHomeDirectory := downloadUserConfigDir, downloadUserHomeDir
	directory := t.TempDir()
	downloadUserConfigDir = func() (string, error) { return directory, nil }
	downloadUserHomeDir = func() (string, error) { return directory, nil }
	t.Cleanup(func() {
		downloadUserConfigDir, downloadUserHomeDir = originalConfigDirectory, originalHomeDirectory
	})
	application := newDownloadTestApp("finished")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	application.downloadCancels["finished"] = cancel
	application.runDownloadTask(ctx, application.ListDownloads()[0], func(*http.Client, string) error { return nil })
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatal("completed task kept its child context alive")
	}
	if item := application.ListDownloads()[0]; item.Status != "completed" {
		t.Fatalf("releasing the context changed successful status: %#v", item)
	}
}
