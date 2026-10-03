package app

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func performancePNG(t testing.TB) []byte {
	t.Helper()
	var buffer bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 320, 160))
	picture.Set(20, 30, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&buffer, picture); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestImageHTTPTransport(t *testing.T) {
	root := t.TempDir()
	data := performancePNG(t)
	source := filepath.Join(root, "sample.png")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(root, "images.zip")
	writeZipEntry(t, archive, "nested/sample.png", data)
	services := New()
	defer services.Shutdown()
	handler := NewMediaMiddleware(services.Media)(http.NotFoundHandler())
	for _, name := range []string{source, archive + "::nested/sample.png"} {
		payload, err := services.Library.LoadImageByPath(name)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(payload.DataURI, imageURLPrefix) || len(payload.DataURI) > 200 {
			t.Fatalf("expected small image URL, got %q", payload.DataURI)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, payload.DataURI, nil))
		if recorder.Code != 200 || !bytes.Equal(recorder.Body.Bytes(), data) {
			t.Fatalf("image response: %d %q", recorder.Code, recorder.Body.String())
		}
		if recorder.Header().Get("Content-Type") != "image/png" || recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal("missing image headers")
		}
		conditional := httptest.NewRequest(http.MethodGet, payload.DataURI, nil)
		conditional.Header.Set("If-None-Match", recorder.Header().Get("ETag"))
		notModified := httptest.NewRecorder()
		handler.ServeHTTP(notModified, conditional)
		if notModified.Code != http.StatusNotModified || notModified.Body.Len() != 0 {
			t.Fatal("image cache revalidation failed")
		}
		head := httptest.NewRecorder()
		handler.ServeHTTP(head, httptest.NewRequest(http.MethodHead, payload.DataURI, nil))
		if head.Code != 200 || head.Body.Len() != 0 {
			t.Fatal("HEAD returned a body")
		}
		request := httptest.NewRequest(http.MethodGet, payload.DataURI, nil)
		request.Header.Set("Range", "bytes=0-7")
		ranged := httptest.NewRecorder()
		handler.ServeHTTP(ranged, request)
		if ranged.Code != 206 || !bytes.Equal(ranged.Body.Bytes(), data[:8]) {
			t.Fatal("image range request failed")
		}
	}
	for method, expected := range map[string]int{http.MethodGet: 404, http.MethodPost: 405} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(method, imageURLPrefix+"missing", nil))
		if recorder.Code != expected {
			t.Fatalf("%s: %d", method, recorder.Code)
		}
	}
	payload, _ := services.Library.LoadImageByPath(source)
	invalid := bytes.Clone(data)
	binary.BigEndian.PutUint32(invalid[16:20], 100000)
	binary.BigEndian.PutUint32(invalid[20:24], 100000)
	binary.BigEndian.PutUint32(invalid[29:33], crc32.ChecksumIEEE(invalid[12:29]))
	if err := os.WriteFile(source, invalid, 0600); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, payload.DataURI, nil))
	if recorder.Code != 422 {
		t.Fatalf("modified oversized image must be revalidated: %d", recorder.Code)
	}
	operation := services.Library.BeginOperation()
	services.Library.CancelOperation(operation)
	defer services.Library.FinishOperation(operation)
	if _, err := services.Library.LoadImageByPathWithOperation(source, operation); !errors.Is(err, errOperationCancelled) {
		t.Fatalf("cancelled prepare: %v", err)
	}
}

func TestStreamedThumbnail(t *testing.T) {
	data := performancePNG(t)
	source := filepath.Join(t.TempDir(), "image.png")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	result, err := renderThumbnail(buildFileImageEntry(source, int64(len(data))), 80)
	if err != nil {
		t.Fatal(err)
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(result))
	if err != nil || config.Width != 80 || config.Height != 40 {
		t.Fatalf("thumbnail dimensions: %+v %v", config, err)
	}
	if thumbnailPixels.used != 0 {
		t.Fatal("pixel budget was not returned")
	}
}

func TestPixelBudgetBlocksAndCancels(t *testing.T) {
	budget := newPixelBudget(100)
	if err := budget.acquire(context.Background(), 80); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- budget.acquire(ctx, 30) }()
	cancel()
	if err := <-result; !errors.Is(err, errOperationCancelled) {
		t.Fatalf("cancelled waiter: %v", err)
	}
	budget.release(80)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			if err := budget.acquire(context.Background(), 60); err != nil {
				t.Error(err)
				return
			}
			budget.mu.Lock()
			used := budget.used
			budget.mu.Unlock()
			if used > 100 {
				t.Errorf("exceeded pixel budget: %d", used)
			}
			budget.release(60)
		})
	}
	wg.Wait()
	if budget.used != 0 {
		t.Fatal("budget leaked")
	}
}

func TestZIPCacheReuseInvalidationAndEviction(t *testing.T) {
	cache := &zipIndexCache{items: make(map[string]*cachedZIP)}
	defer cache.clear()
	archive := filepath.Join(t.TempDir(), "images.zip")
	writeZipEntry(t, archive, "sample.png", []byte("old"))
	entry := buildArchiveImageEntry(archive, "sample.png", 3)
	first, err := cache.open(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	item := cache.items[archive]
	second, err := cache.open(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	second.Close()
	if cache.items[archive] != item {
		t.Fatal("ZIP index rebuilt on cache hit")
	}
	replacement := filepath.Join(filepath.Dir(archive), "replacement.zip")
	writeZipEntry(t, replacement, "sample.png", []byte("new content"))
	if err := os.Rename(replacement, archive); err != nil {
		t.Fatal(err)
	}
	updated, err := cache.open(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	defer updated.Close()
	data, _ := io.ReadAll(updated)
	if string(data) != "new content" {
		t.Fatalf("stale ZIP content: %q", data)
	}
	cache.clear()
	data, err = io.ReadAll(first)
	if err != nil || string(data) != "old" {
		t.Fatalf("eviction interrupted existing ZIP reader: %q %v", data, err)
	}
	first.Close()
	first.Close() // Close 必須可重複呼叫。
	if item.users != 0 {
		t.Fatal("ZIP reference count leaked")
	}
	for index := 0; index < maxCachedZIPs+2; index++ {
		name := filepath.Join(filepath.Dir(archive), fmt.Sprintf("%d.zip", index))
		writeZipEntry(t, name, "sample.png", []byte("image"))
		reader, err := cache.open(context.Background(), buildArchiveImageEntry(name, "sample.png", 5))
		if err != nil {
			t.Fatal(err)
		}
		reader.Close()
	}
	if len(cache.items) > maxCachedZIPs {
		t.Fatal("ZIP cache exceeded limit")
	}
}

func TestTARCacheReuseAndCleanup(t *testing.T) {
	archive := filepath.Join(t.TempDir(), "images.tar.gz")
	writeTarGzipEntry(t, archive, "nested/sample.png", []byte("old"))
	cache := &tarIndexCache{items: make(map[string]*cachedTAR)}
	defer cache.clear()
	entry := buildArchiveImageEntry(archive, "nested/sample.png", 3)
	reader, err := cache.open(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	original := cache.items[archive]
	if original.file == nil {
		t.Fatal("TAR was not cached")
	}
	temporary := original.file.Name()
	another, err := cache.open(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	another.Close()
	if cache.items[archive] != original {
		t.Fatal("TAR decompressed on cache hit")
	}
	replacement := filepath.Join(filepath.Dir(archive), "replacement.tar.gz")
	writeTarGzipEntry(t, replacement, "nested/sample.png", []byte("new content"))
	if err := os.Rename(replacement, archive); err != nil {
		t.Fatal(err)
	}
	updated, err := cache.open(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(updated)
	updated.Close()
	if string(data) != "new content" {
		t.Fatalf("stale TAR content: %q", data)
	}
	cache.clear()
	data, err = io.ReadAll(reader)
	if err != nil || string(data) != "old" {
		t.Fatalf("eviction interrupted TAR reader: %q %v", data, err)
	}
	reader.Close()
	if _, err := os.Stat(temporary); !os.IsNotExist(err) {
		t.Fatalf("TAR temporary file not removed: %v", err)
	}
	if cache.liveFiles != 0 {
		t.Fatal("TAR temporary-file budget leaked")
	}
}

func TestTARCacheLimitFallsBack(t *testing.T) {
	archive := filepath.Join(t.TempDir(), "large.tar")
	file, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	writer := tar.NewWriter(file)
	if err := writer.WriteHeader(&tar.Header{Name: "sample.png", Size: 3, Mode: 0600}); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte("abc")); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteHeader(&tar.Header{Name: "large.bin", Size: maxCachedTARBytes, Mode: 0600}); err != nil {
		t.Fatal(err)
	}
	// 建立稀疏實體檔案作為超大封存資料，無須配置 256 MB 記憶體。
	position, _ := file.Seek(0, io.SeekCurrent)
	if err := file.Truncate(position + maxCachedTARBytes + 1024); err != nil {
		t.Fatal(err)
	}
	file.Close()
	cache := &tarIndexCache{items: make(map[string]*cachedTAR)}
	defer cache.clear()
	entry := buildArchiveImageEntry(archive, "sample.png", 3)
	reader, err := cache.open(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	data, err := io.ReadAll(reader)
	if err != nil || string(data) != "abc" {
		t.Fatalf("fallback failed: %q %v", data, err)
	}
	item := cache.items[archive]
	if item == nil || item.file != nil {
		t.Fatal("oversized TAR should be marked uncached")
	}
	if cache.liveFiles != 0 {
		t.Fatal("oversized TAR retained a temporary file")
	}
}

func BenchmarkZIPEntryLookup(b *testing.B) {
	archive := filepath.Join(b.TempDir(), "images.zip")
	file, err := os.Create(archive)
	if err != nil {
		b.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for index := 0; index < 5000; index++ {
		w, err := writer.Create(fmt.Sprintf("%d.png", index))
		if err != nil {
			b.Fatal(err)
		}
		w.Write([]byte("data"))
	}
	writer.Close()
	file.Close()
	entry := buildArchiveImageEntry(archive, "4999.png", 4)
	b.Run("reopen-and-scan", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			reader, err := zip.OpenReader(archive)
			if err != nil {
				b.Fatal(err)
			}
			for _, file := range reader.File {
				if file.Name == entry.InnerPath {
					opened, err := file.Open()
					if err != nil {
						b.Fatal(err)
					}
					io.Copy(io.Discard, opened)
					opened.Close()
					break
				}
			}
			reader.Close()
		}
	})
	b.Run("cached-index", func(b *testing.B) {
		cache := &zipIndexCache{items: make(map[string]*cachedZIP)}
		defer cache.clear()
		first, err := cache.open(context.Background(), entry)
		if err != nil {
			b.Fatal(err)
		}
		first.Close()
		b.ReportAllocs()
		b.ResetTimer()
		for b.Loop() {
			reader, err := cache.open(context.Background(), entry)
			if err != nil {
				b.Fatal(err)
			}
			io.Copy(io.Discard, reader)
			reader.Close()
		}
	})
}

func TestImageHTTPETag(t *testing.T) {
	source := filepath.Join(t.TempDir(), "image.png")
	if err := os.WriteFile(source, performancePNG(t), 0600); err != nil {
		t.Fatal(err)
	}
	services := New()
	defer services.Shutdown()
	payload, err := services.Library.LoadImageByPath(source)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewMediaMiddleware(services.Media)(http.NotFoundHandler())
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest("GET", payload.DataURI, nil))
	request := httptest.NewRequest("GET", payload.DataURI, nil)
	request.Header.Set("If-None-Match", first.Header().Get("ETag"))
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, request)
	if second.Code != 304 {
		t.Fatalf("ETag not reused: %d", second.Code)
	}
	future := time.Now().Add(time.Second)
	if err := os.Chtimes(source, future, future); err != nil {
		t.Fatal(err)
	}
	third := httptest.NewRecorder()
	handler.ServeHTTP(third, request)
	if third.Code != 200 {
		t.Fatalf("ETag was not invalidated: %d", third.Code)
	}
}

type zeroArchiveReader struct{}

func (zeroArchiveReader) Read(buffer []byte) (int, error) { clear(buffer); return len(buffer), nil }

func TestTARCacheDecompressionLimit(t *testing.T) {
	archive := filepath.Join(t.TempDir(), "compressed.tar.gz")
	file, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	compressed := gzip.NewWriter(file)
	writer := tar.NewWriter(compressed)
	if err := writer.WriteHeader(&tar.Header{Name: "sample.png", Size: 3, Mode: 0600}); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte("abc")); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteHeader(&tar.Header{Name: "zeros.bin", Size: maxCachedTARBytes, Mode: 0600}); err != nil {
		t.Fatal(err)
	}
	if _, err := io.CopyN(writer, zeroArchiveReader{}, maxCachedTARBytes); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := compressed.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	cache := &tarIndexCache{items: make(map[string]*cachedTAR)}
	defer cache.clear()
	reader, err := cache.open(context.Background(), buildArchiveImageEntry(archive, "sample.png", 3))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	data, err := io.ReadAll(reader)
	if err != nil || string(data) != "abc" {
		t.Fatalf("compressed TAR fallback: %q %v", data, err)
	}
	if cache.items[archive].file != nil || cache.liveFiles != 0 {
		t.Fatal("decompressed TAR exceeded cache budget")
	}
}
