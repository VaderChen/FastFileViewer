package app

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestArchiveCacheWaitingOpenCanCancel(t *testing.T) {
	zipCache := &zipIndexCache{items: make(map[string]*cachedZIP)}
	tarCache := &tarIndexCache{items: make(map[string]*cachedTAR)}
	cases := []struct {
		name string
		lock sync.Locker
		open func(context.Context, ImageEntry) (io.ReadCloser, error)
	}{
		{"zip", &zipCache.mu, zipCache.open},
		{"tar", &tarCache.mu, tarCache.open},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			test.lock.Lock()
			locked := true
			defer func() {
				if locked {
					test.lock.Unlock()
				}
			}()
			entry := ImageEntry{ArchivePath: filepath.Join(t.TempDir(), "missing."+test.name)}
			started := make(chan struct{})
			finished := make(chan error, 1)
			go func() {
				close(started)
				reader, err := test.open(ctx, entry)
				if reader != nil {
					_ = reader.Close()
				}
				finished <- err
			}()
			<-started
			// Leave the operation pending on the held lock before cancelling.
			select {
			case err := <-finished:
				t.Fatalf("open passed an already-held cache lock: %v", err)
			case <-time.After(20 * time.Millisecond):
			}
			cancel()
			select {
			case err := <-finished:
				if !errors.Is(err, errOperationCancelled) {
					t.Fatalf("waiting operation returned %v", err)
				}
			case <-time.After(time.Second):
				test.lock.Unlock()
				locked = false
				<-finished
				t.Fatal("cancelled operation waited for another archive to release its cache lock")
			}
		})
	}
}

func archiveWithSingleEntry(t *testing.T, format, name, content string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if format == "zip" {
		writer := zip.NewWriter(&buffer)
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(entry, content); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
	} else {
		writer := tar.NewWriter(&buffer)
		if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0600, Size: int64(len(content))}); err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(writer, content); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
	}
	return buffer.Bytes()
}

func TestArchiveCacheInvalidatesPreservedModificationTime(t *testing.T) {
	for _, format := range []string{"zip", "tar"} {
		t.Run(format, func(t *testing.T) {
			archive := filepath.Join(t.TempDir(), "images."+format)
			oldData := archiveWithSingleEntry(t, format, "first.png", "old")
			newData := archiveWithSingleEntry(t, format, "other.png", "new")
			if len(oldData) != len(newData) {
				t.Fatal("fixture sizes differ")
			}
			if err := os.WriteFile(archive, oldData, 0600); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(archive)
			if err != nil {
				t.Fatal(err)
			}
			if thumbnailFileIdentity(before) == "" {
				t.Skip("platform does not expose change-time identity")
			}
			zipCache := &zipIndexCache{items: make(map[string]*cachedZIP)}
			defer zipCache.clear()
			tarCache := &tarIndexCache{items: make(map[string]*cachedTAR)}
			defer tarCache.clear()
			open := zipCache.open
			if format == "tar" {
				open = tarCache.open
			}
			first, err := open(context.Background(), buildArchiveImageEntry(archive, "first.png", 3))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := io.Copy(io.Discard, first); err != nil {
				t.Fatal(err)
			}
			if err := first.Close(); err != nil {
				t.Fatal(err)
			}
			// Rewrite the existing inode, just as synchronization tools may do,
			// preserving its byte count and timestamp while changing archive entries.
			if err := os.WriteFile(archive, newData, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chtimes(archive, before.ModTime(), before.ModTime()); err != nil {
				t.Fatal(err)
			}
			after, err := os.Stat(archive)
			if err != nil {
				t.Fatal(err)
			}
			if !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
				t.Fatal("fixture did not preserve inode, size and modification time")
			}
			if thumbnailFileIdentity(before) == thumbnailFileIdentity(after) {
				t.Fatal("filesystem did not record changed archive identity")
			}
			if stale, err := open(context.Background(), buildArchiveImageEntry(archive, "first.png", 3)); err == nil {
				_ = stale.Close()
				t.Fatal("cache exposed an entry removed from the current archive")
			}
			updated, err := open(context.Background(), buildArchiveImageEntry(archive, "other.png", 3))
			if err != nil {
				t.Fatal(err)
			}
			defer updated.Close()
			content, err := io.ReadAll(updated)
			if err != nil || string(content) != "new" {
				t.Fatalf("updated archive content = %q, err = %v", content, err)
			}
		})
	}
}
