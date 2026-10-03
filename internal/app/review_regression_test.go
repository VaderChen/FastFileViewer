package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
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

func TestFileOperationsRejectTargetCreatedDuringRename(t *testing.T) {
	for _, operation := range []string{"rename", "move"} {
		t.Run(operation, func(t *testing.T) {
			root := t.TempDir()
			source := writeFileOperationFixture(t, root, "source.txt", "source")
			destination := filepath.Join(root, "destination")
			if err := os.Mkdir(destination, 0700); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(root, "target.txt")
			if operation == "move" {
				target = filepath.Join(destination, "source.txt")
			}
			original := renameFile
			renameFile = func(from, to string) error {
				if err := os.WriteFile(to, []byte("other document"), 0600); err != nil {
					return err
				}
				return original(from, to)
			}
			defer func() { renameFile = original }()
			service := New().File
			if operation == "rename" {
				if _, err := service.RenameEntry(source, "target.txt"); !errors.Is(err, os.ErrExist) {
					t.Fatalf("expected collision, got %v", err)
				}
			} else {
				result, err := service.MoveEntries([]string{source}, destination)
				if err != nil || len(result.Moved) != 0 || len(result.Failed) != 1 {
					t.Fatalf("unexpected result: %+v %v", result, err)
				}
			}
			data, _ := os.ReadFile(target)
			originalData, _ := os.ReadFile(source)
			if string(data) != "other document" || string(originalData) != "source" {
				t.Fatal("collision destroyed data")
			}
		})
	}
}

func TestMoveResultIdentifiesOriginalForSameName(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, filepath.Join(root, "from"), "same.txt", "original")
	target := filepath.Join(root, "to")
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	original, err := entryByPath(source)
	if err != nil {
		t.Fatal(err)
	}
	result, err := New().File.MoveEntries([]string{filepath.Join(root, "a.zip") + "::same.txt", source}, target)
	if err != nil || len(result.Moved) != 1 || len(result.Failed) != 1 {
		t.Fatalf("%+v %v", result, err)
	}
	if result.OriginalIDs[result.Moved[0].ID] != original.ID {
		t.Fatal("missing original identity")
	}
}

func TestExportNameStopsOnInvalidInputAndCancellation(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{strings.Repeat("a", 300) + ".txt", ".", ""} {
		if _, err := uniqueExportName(context.Background(), root, name, nil); err == nil {
			t.Fatal("invalid name accepted")
		}
	}
	source := writeFileOperationFixture(t, root, "file.txt", "existing")
	if _, err := uniqueExportName(context.Background(), source, "child.txt", nil); err == nil {
		t.Fatal("non-directory destination accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := uniqueExportName(ctx, root, "file.txt", nil); !errors.Is(err, errOperationCancelled) {
		t.Fatalf("cancellation: %v", err)
	}
	name, err := uniqueExportName(context.Background(), root, "file.txt", nil)
	if err != nil || name != "file-2.txt" {
		t.Fatalf("%s %v", name, err)
	}
}

func TestExportEarlyReturnFinishesOperation(t *testing.T) {
	app := New().Library
	for _, entries := range [][]ImageEntry{nil, {{Name: "test.txt"}}} {
		id := app.BeginOperation()
		if _, err := app.ExportImages(entries, "", id); err == nil {
			t.Fatal("expected early error")
		}
		if !errors.Is(checkOperation(app.operationContext(id)), errOperationCancelled) {
			t.Fatal("operation leaked")
		}
	}
}

func TestHEICTransportPreservesBrowserDecoderPolicy(t *testing.T) {
	root := t.TempDir()
	// Transport policy fixture; decoding itself belongs to WebKit.
	data := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'h', 'e', 'i', 'c', 0, 0, 0, 0, 'h', 'e', 'i', 'c', 'm', 'i', 'f', '1'}
	source := filepath.Join(root, "sample.heic")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(root, "sample.zip")
	writeZipEntry(t, archive, "sample.heic", data)
	services := New()
	defer services.Shutdown()
	handler := NewMediaMiddleware(services.Media)(http.NotFoundHandler())
	for _, path := range []string{source, archive + "::sample.heic"} {
		payload, err := services.Library.LoadImageByPath(path)
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", payload.DataURI, nil))
		if response.Code != 200 || !bytes.Equal(response.Body.Bytes(), data) {
			t.Fatalf("%s: %d", path, response.Code)
		}
	}
	if err := validateImageReader(ImageEntry{Format: ".heic"}, bytes.NewReader(data), maxImageBytes+1); err == nil {
		t.Fatal("HEIC bypassed byte limit")
	}
}

func TestThumbnailDiskCacheEnforcesCountOnEveryWrite(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < maxThumbnailCacheFiles; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("%04d.png", i)), []byte("cached"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	cache := &thumbnailDiskCache{}
	var workers sync.WaitGroup
	for i := 0; i < 12; i++ {
		workers.Add(1)
		go func(i int) {
			defer workers.Done()
			if err := cache.store(filepath.Join(root, fmt.Sprintf("new-%d.png", i)), []byte("new")); err != nil {
				t.Error(err)
			}
		}(i)
	}
	workers.Wait()
	files, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != maxThumbnailCacheFiles || len(cache.entries) != maxThumbnailCacheFiles {
		t.Fatalf("unbounded cache: %d", len(files))
	}
}

func TestThumbnailDiskCacheEnforcesTotalBytesAndRecency(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "old.png")
	file, err := os.Create(old)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxThumbnailDiskBytes); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	cache := &thumbnailDiskCache{}
	newest := filepath.Join(root, "new.png")
	if err := cache.store(newest, []byte("new")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("disk byte limit not enforced")
	}
	if data, err := cache.read(newest); err != nil || string(data) != "new" {
		t.Fatalf("recent entry lost: %v", err)
	}
}

func TestMediaArchiveCacheRefreshesWhenSourceChanges(t *testing.T) {
	root := t.TempDir()
	archive := filepath.Join(root, "media.zip")
	writeZipEntry(t, archive, "movie.mp4", []byte("first"))
	services := New()
	defer services.Shutdown()
	entry, err := entryByPath(archive + "::movie.mp4")
	if err != nil {
		t.Fatal(err)
	}
	first, err := services.Media.seekableMediaPath(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	// Open handles must continue reading their original contents during replacement.
	active, err := os.Open(first)
	if err != nil {
		t.Fatal(err)
	}
	defer active.Close()
	writeZipEntry(t, archive, "movie.mp4", []byte("updated video"))
	stamp := time.Now().Add(time.Second)
	if err := os.Chtimes(archive, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	second, err := services.Media.seekableMediaPath(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(second)
	if err != nil || string(data) != "updated video" {
		t.Fatalf("stale cache: %q %v", data, err)
	}
	previous, err := io.ReadAll(active)
	if err != nil || string(previous) != "first" {
		t.Fatalf("active stream changed: %q %v", previous, err)
	}
}

func TestMediaCacheRejectsSourceChangedDuringPreparation(t *testing.T) {
	source := writeFileOperationFixture(t, t.TempDir(), "audio.wav", "first")
	entry, err := entryByPath(source)
	if err != nil {
		t.Fatal(err)
	}
	fingerprint, err := fingerprintMediaSource(entry)
	if err != nil {
		t.Fatal(err)
	}
	service := New().Media
	defer service.cleanup()
	directory, err := service.ensureMediaCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	cached := writeFileOperationFixture(t, directory, "audio.m4a", "converted")
	if err := os.WriteFile(source, []byte("changed content"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := service.storeMediaCache(entry.ID, cached, fingerprint); err == nil {
		t.Fatal("stored stale conversion")
	}
	if _, err := os.Stat(cached); !os.IsNotExist(err) {
		t.Fatal("failed conversion cache remains")
	}
}

func TestHLSVariantRedirectResolvesRelativeSegments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/master.m3u8":
			fmt.Fprint(w, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nvariant.m3u8\n")
		case "/variant.m3u8":
			http.Redirect(w, r, "/cdn/live/playlist.m3u8", http.StatusFound)
		case "/cdn/live/playlist.m3u8":
			fmt.Fprint(w, "#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n")
		case "/cdn/live/segment.ts":
			fmt.Fprint(w, "redirected media")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	application := newDownloadTestApp("redirect")
	if err := application.downloadToDirectory(context.Background(), server.Client(), "redirect", server.URL+"/master.m3u8", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(application.ListDownloads()[0].Path)
	if err != nil || string(data) != "redirected media" {
		t.Fatalf("%q %v", data, err)
	}
}
