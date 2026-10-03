package app

import (
	"archive/zip"
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func useTestThumbnailCache(t *testing.T) {
	t.Helper()
	prior := userCacheDir
	directory := t.TempDir()
	userCacheDir = func() (string, error) { return directory, nil }
	t.Cleanup(func() { userCacheDir = prior })
}

func solidThumbnailFixture(t *testing.T, value color.NRGBA) []byte {
	t.Helper()
	picture := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			picture.SetNRGBA(x, y, value)
		}
	}
	var output bytes.Buffer
	if err := png.Encode(&output, picture); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func TestThumbnailCacheInvalidatesReplacedFilePreservingSizeAndTime(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("native file identity policy")
	}
	useTestThumbnailCache(t)
	red := solidThumbnailFixture(t, color.NRGBA{R: 255, A: 255})
	blue := solidThumbnailFixture(t, color.NRGBA{B: 255, A: 255})
	length := max(len(red), len(blue))
	red = append(red, make([]byte, length-len(red))...)
	blue = append(blue, make([]byte, length-len(blue))...)
	directory := t.TempDir()
	source := filepath.Join(directory, "image.png")
	if err := os.WriteFile(source, red, 0600); err != nil {
		t.Fatal(err)
	}
	stamp := time.Now().Add(-time.Hour)
	if err := os.Chtimes(source, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	services := New()
	defer services.Shutdown()
	first, err := services.Library.LoadThumbnailByPath(source, 280)
	if err != nil {
		t.Fatal(err)
	}
	again, err := services.Library.LoadThumbnailByPath(source, 280)
	if err != nil || again.DataURI != first.DataURI {
		t.Fatal("unchanged source cache mismatch")
	}
	replacement := filepath.Join(directory, "replacement.png")
	if err := os.WriteFile(replacement, blue, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(replacement, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, source); err != nil {
		t.Fatal(err)
	}
	second, err := services.Library.LoadThumbnailByPath(source, 280)
	if err != nil {
		t.Fatal(err)
	}
	if second.DataURI == first.DataURI {
		t.Fatal("replaced image returned stale thumbnail")
	}
}

func TestThumbnailCacheInvalidatesArchiveSizeWithPreservedTime(t *testing.T) {
	useTestThumbnailCache(t)
	root := t.TempDir()
	archive := filepath.Join(root, "images.zip")
	stamp := time.Now().Add(-time.Hour)
	writeArchive := func(data []byte, extra bool) {
		file, err := os.Create(archive)
		if err != nil {
			t.Fatal(err)
		}
		writer := zip.NewWriter(file)
		item, err := writer.Create("image.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := item.Write(data); err != nil {
			t.Fatal(err)
		}
		if extra {
			padding, err := writer.Create("extra.txt")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := padding.Write([]byte("archive changed")); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(archive, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	writeArchive(solidThumbnailFixture(t, color.NRGBA{R: 255, A: 255}), false)
	services := New()
	defer services.Shutdown()
	first, err := services.Library.LoadThumbnailByPath(archive+"::image.png", 280)
	if err != nil {
		t.Fatal(err)
	}
	writeArchive(solidThumbnailFixture(t, color.NRGBA{B: 255, A: 255}), true)
	second, err := services.Library.LoadThumbnailByPath(archive+"::image.png", 280)
	if err != nil {
		t.Fatal(err)
	}
	if first.DataURI == second.DataURI {
		t.Fatal("updated archive returned stale thumbnail")
	}
}

func TestThumbnailDiskCacheForgetsFilesRemovedExternally(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "thumbnail.png")
	cache := &thumbnailDiskCache{}
	if err := cache.store(path, []byte("data")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := cache.read(path); !os.IsNotExist(err) {
		t.Fatalf("expected cache miss: %v", err)
	}
	if len(cache.entries) != 0 || cache.bytes != 0 {
		t.Fatal("deleted thumbnail still consumes cache budget")
	}
}

func TestThumbnailCacheRejectsSymlinksAndOversizedFiles(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "outside")
	if err := os.WriteFile(target, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "thumbnail.png")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := readThumbnailCache(link); err == nil {
		t.Fatal("cache followed a symlink")
	}
	file, err := os.Create(filepath.Join(root, "huge.png"))
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxThumbnailCacheBytes + 1); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := readThumbnailCache(file.Name()); err == nil {
		t.Fatal("oversized thumbnail accepted")
	}
}
