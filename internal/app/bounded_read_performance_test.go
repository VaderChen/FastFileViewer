package app

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func BenchmarkBoundedEntryRead(b *testing.B) {
	for _, size := range []int{128 * 1024, 1024 * 1024, 8 * 1024 * 1024} {
		b.Run(fmt.Sprintf("%dKiB", size/1024), func(b *testing.B) {
			payload := bytes.Repeat([]byte("x"), size)
			filePath := filepath.Join(b.TempDir(), "sample.bin")
			if err := os.WriteFile(filePath, payload, 0600); err != nil {
				b.Fatal(err)
			}
			entry := buildFileImageEntry(filePath, int64(len(payload)))
			b.SetBytes(int64(size))
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				actual, err := readEntryLimited(entry, maxImageBytes)
				if err != nil || len(actual) != len(payload) {
					b.Fatalf("read %d bytes: %v", len(actual), err)
				}
			}
		})
	}
}

func BenchmarkBoundedThumbnailCacheRead(b *testing.B) {
	payload := bytes.Repeat([]byte("x"), 128*1024)
	cachePath := filepath.Join(b.TempDir(), "thumbnail.png")
	if err := os.WriteFile(cachePath, payload, 0600); err != nil {
		b.Fatal(err)
	}
	b.SetBytes(int64(len(payload)))
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		actual, err := readThumbnailCache(cachePath)
		if err != nil || len(actual) != len(payload) {
			b.Fatalf("read %d bytes: %v", len(actual), err)
		}
	}
}

func BenchmarkBoundedLibraryCacheRead(b *testing.B) {
	root := b.TempDir()
	original := userCacheDir
	userCacheDir = func() (string, error) { return root, nil }
	b.Cleanup(func() { userCacheDir = original })
	application := New().Library
	payload := string(bytes.Repeat([]byte("x"), 1024*1024))
	if err := application.SaveLibraryCache("library", payload); err != nil {
		b.Fatal(err)
	}
	b.SetBytes(int64(len(payload)))
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		actual, err := application.LoadLibraryCache("library")
		if err != nil || len(actual) != len(payload) {
			b.Fatalf("read %d bytes: %v", len(actual), err)
		}
	}
}

func TestBoundedEntryReadUsesActualSize(t *testing.T) {
	payload := bytes.Repeat([]byte("sample"), 200)
	filePath := filepath.Join(t.TempDir(), "sample.txt")
	if err := os.WriteFile(filePath, payload, 0600); err != nil {
		t.Fatal(err)
	}
	for _, hint := range []int64{-1, 0, 1, 1024, int64(len(payload))} {
		t.Run(fmt.Sprint(hint), func(t *testing.T) {
			entry := buildFileImageEntry(filePath, hint)
			actual, err := readEntryLimited(entry, int64(len(payload)))
			if err != nil || !bytes.Equal(actual, payload) {
				t.Fatalf("read %d bytes: %v", len(actual), err)
			}
			entry.Size = 0
			actual, err = readEntryLimited(entry, int64(len(payload)-1))
			if err == nil || actual != nil {
				t.Fatal("stale metadata bypassed read limit")
			}
		})
	}
}

func TestBoundedEntryReadVerifiesZIPChecksum(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "corrupt.zip")
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	file, err := writer.CreateHeader(&zip.FileHeader{Name: "sample.txt", Method: zip.Store})
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("entry payload for checksum verification")
	if _, err := file.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	raw := archive.Bytes()
	offset := bytes.Index(raw, payload)
	if offset < 0 {
		t.Fatal("stored payload missing")
	}
	raw[offset] ^= 0xff
	if err := os.WriteFile(filePath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { archiveZIPs.clear() })
	entry := buildArchiveImageEntry(filePath, "sample.txt", int64(len(payload)))
	actual, err := readEntryLimited(entry, int64(len(payload)))
	if !errors.Is(err, zip.ErrChecksum) || actual != nil {
		t.Fatalf("checksum error lost: %v", err)
	}
}

type finalReadError struct {
	reader io.Reader
	err    error
}

func (r *finalReadError) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if err == io.EOF {
		return n, r.err
	}
	return n, err
}

func TestSizeHintReadPreservesContentsAndErrors(t *testing.T) {
	for _, size := range []int{0, 1, 511, 512, 513, 4096, int(maxReadSizeHint) + 10} {
		payload := bytes.Repeat([]byte("x"), size)
		for _, hint := range []int64{-1, 0, 1, 512, int64(size), int64(size) + 1, maxReadSizeHint + 1} {
			t.Run(fmt.Sprintf("size%d_hint%d", size, hint), func(t *testing.T) {
				actual, err := readAllWithSizeHint(bytes.NewReader(payload), hint)
				if err != nil || !bytes.Equal(actual, payload) {
					t.Fatalf("read %d bytes: %v", len(actual), err)
				}
				expectedErr := errors.New("late checksum error")
				actual, err = readAllWithSizeHint(&finalReadError{reader: bytes.NewReader(payload), err: expectedErr}, hint)
				if !errors.Is(err, expectedErr) || !bytes.Equal(actual, payload) {
					t.Fatalf("late error lost: %v", err)
				}
			})
		}
	}
}

func TestSizeHintReadPreservesFinalCancellation(t *testing.T) {
	for _, hint := range []int64{0, 1, 512, maxReadSizeHint + 1} {
		t.Run(fmt.Sprint(hint), func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			reader := &contextReader{ctx: ctx, reader: cancellingFinalReader{cancel: cancel}}
			_, err := readAllWithSizeHint(reader, hint)
			if !errors.Is(err, errOperationCancelled) {
				t.Fatalf("final cancellation lost: %v", err)
			}
		})
	}
}
