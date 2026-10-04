package app

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestScanUsesSymlinkTargetSizeAndSkipsDirectoryAliases(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "source.txt")
	content := []byte("actual target content has a different size")
	if err := os.WriteFile(source, content, 0600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(directory, "alias.txt")
	if err := os.Symlink(source, alias); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(directory, filepath.Join(directory, "folder.png")); err != nil {
		t.Fatal(err)
	}
	result, err := New().Library.ScanDirectory(directory, nil, nil, nil, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Node.Images) != 2 {
		t.Fatalf("non-file alias included: %#v", result.Node.Images)
	}
	for _, entry := range result.Node.Images {
		if entry.Size != int64(len(content)) {
			t.Fatalf("symlink size is not target size: %#v", entry)
		}
	}
	groups, err := New().Library.DetectDuplicates(result.Node.Images, 0)
	if err != nil || len(groups) != 1 || len(groups[0].Images) != 2 {
		t.Fatalf("identical link and file must be compared with real sizes: %#v, %v", groups, err)
	}
}

func TestLibraryCacheRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	original := userCacheDir
	userCacheDir = func() (string, error) { return root, nil }
	t.Cleanup(func() { userCacheDir = original })
	cachePath, err := libraryCachePath("/library")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(cachePath), 0700); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "outside.json")
	if err := os.WriteFile(target, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, cachePath); err != nil {
		t.Fatal(err)
	}
	if payload, err := New().Library.LoadLibraryCache("/library"); err == nil || payload != "" {
		t.Fatalf("non-regular cache was read: %q, %v", payload, err)
	}
}

type cancellingFinalReader struct{ cancel context.CancelFunc }

func (reader cancellingFinalReader) Read(buffer []byte) (int, error) {
	n := copy(buffer, "final bytes")
	reader.cancel()
	return n, io.EOF
}

func TestContextReaderPreservesCancellationOnFinalData(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader := &contextReader{ctx: ctx, reader: cancellingFinalReader{cancel: cancel}}
	written, err := io.Copy(io.Discard, reader)
	if !errors.Is(err, errOperationCancelled) {
		t.Fatalf("final EOF hid cancellation after %d bytes: %v", written, err)
	}
}

func TestLibrarySkipsAndRejectsSpecialFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("FIFO fixture requires Unix")
	}
	directory := t.TempDir()
	source := filepath.Join(directory, "pipe.txt")
	if output, err := exec.Command("mkfifo", source).CombinedOutput(); err != nil {
		t.Fatalf("mkfifo: %v: %s", err, output)
	}
	application := New().Library
	result, err := application.ScanDirectory(directory, nil, nil, nil, nil, 0)
	if err != nil || len(result.Node.Images) != 0 {
		t.Fatalf("FIFO included in library: %#v, %v", result, err)
	}
	if _, err := application.OpenFileByPath(source); !errors.Is(err, errNotRegularFile) {
		t.Fatalf("FIFO registered: %v", err)
	}
}

func TestEntryReadersRejectSpecialFilesWithoutBlocking(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("FIFO fixture requires Unix")
	}
	for _, extension := range []string{".txt", ".zip", ".tar", ".tgz"} {
		t.Run(extension, func(t *testing.T) {
			source := filepath.Join(t.TempDir(), "pipe"+extension)
			if output, err := exec.Command("mkfifo", source).CombinedOutput(); err != nil {
				t.Fatalf("mkfifo: %v: %s", err, output)
			}
			entry := buildFileImageEntry(source, 0)
			if extension != ".txt" {
				entry = buildArchiveImageEntry(source, "image.png", 0)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				reader, err := openEntryReader(ctx, entry)
				if reader != nil {
					_ = reader.Close()
				}
				done <- err
			}()
			select {
			case err := <-done:
				if !errors.Is(err, errNotRegularFile) {
					t.Fatalf("expected regular-file error, got %v", err)
				}
			case <-time.After(time.Second):
				cancel()
				// Allow a broken blocking implementation to exit before failing.
				writer, err := os.OpenFile(source, os.O_RDWR, 0600)
				if err != nil {
					t.Fatal(err)
				}
				_ = writer.Close()
				select {
				case <-done:
				case <-time.After(2 * time.Second):
					t.Fatal("reader did not exit after FIFO was released")
				}
				t.Fatal("reader blocked on special file")
			}
		})
	}
}

type replaceExportContext struct {
	context.Context
	cancel      context.CancelFunc
	target      string
	replacement string
	fired       bool
	err         error
}

func (ctx *replaceExportContext) Done() <-chan struct{} {
	if !ctx.fired {
		if _, err := os.Lstat(ctx.target); err == nil {
			ctx.fired = true
			if ctx.replacement != "" {
				ctx.err = os.Rename(ctx.replacement, ctx.target)
			}
			ctx.cancel()
		}
	}
	return ctx.Context.Done()
}

func TestExportCancellationRemovesOnlyItsOwnFile(t *testing.T) {
	for _, replace := range []bool{false, true} {
		name := "partial output"
		if replace {
			name = "concurrent replacement"
		}
		t.Run(name, func(t *testing.T) {
			directory := t.TempDir()
			source := filepath.Join(directory, "source.txt")
			target := filepath.Join(directory, "export.txt")
			if err := os.WriteFile(source, []byte("export data"), 0600); err != nil {
				t.Fatal(err)
			}
			parent, cancel := context.WithCancel(context.Background())
			defer cancel()
			ctx := &replaceExportContext{Context: parent, cancel: cancel, target: target}
			if replace {
				ctx.replacement = filepath.Join(directory, "replacement.txt")
				if err := os.WriteFile(ctx.replacement, []byte("other document"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			err := copyEntryToFile(ctx, buildFileImageEntry(source, 11), target)
			if ctx.err != nil {
				t.Fatal(ctx.err)
			}
			if !ctx.fired || !errors.Is(err, errOperationCancelled) {
				t.Fatalf("did not cancel active copy: %v", err)
			}
			data, readErr := os.ReadFile(target)
			if replace {
				if readErr != nil || string(data) != "other document" {
					t.Fatalf("rollback deleted replacement: %q, %v", data, readErr)
				}
			} else if !os.IsNotExist(readErr) {
				t.Fatalf("cancelled export left partial output: %v", readErr)
			}
		})
	}
}
