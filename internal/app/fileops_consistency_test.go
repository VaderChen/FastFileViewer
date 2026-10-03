package app

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestFileOperationsRetirePreviousImageRegistration(t *testing.T) {
	for _, operation := range []string{"rename", "move", "trash"} {
		t.Run(operation, func(t *testing.T) {
			t.Setenv("HOME", t.TempDir())
			root := t.TempDir()
			source := writeFileOperationFixture(t, root, "picture.svg", "<svg/>")
			services := New()
			defer services.Shutdown()
			payload, err := services.Library.LoadImageByPath(source)
			if err != nil {
				t.Fatal(err)
			}
			var replacement ImageEntry
			switch operation {
			case "rename":
				replacement, err = services.File.RenameEntry(source, "renamed.svg")
			case "move":
				result, moveErr := services.File.MoveEntries([]string{source}, t.TempDir())
				err = moveErr
				if len(result.Moved) != 1 || len(result.Failed) != 0 {
					t.Fatalf("move did not complete: %#v", result)
				}
				replacement = result.Moved[0]
			case "trash":
				result, trashErr := services.File.TrashEntries([]string{source})
				err = trashErr
				if len(result.RemovedIDs) != 1 || len(result.Failed) != 0 {
					t.Fatalf("trash did not complete: %#v", result)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, exists := services.Library.entries.lookup(hashID("file", source)); exists {
				t.Error("completed operation retained the previous path registration")
			}
			if operation != "trash" {
				if got, exists := services.Library.entries.lookup(replacement.ID); !exists || got.Path != replacement.Path {
					t.Errorf("completed operation did not register replacement: %#v %v", got, exists)
				}
			}
			if err := os.WriteFile(source, []byte("<svg>unrelated replacement</svg>"), 0600); err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			NewMediaMiddleware(services.Media)(http.NotFoundHandler()).ServeHTTP(response, httptest.NewRequest(http.MethodGet, payload.DataURI, nil))
			if response.Code != http.StatusNotFound {
				t.Fatalf("old image URL served a newly created unrelated file: status=%d body=%q", response.Code, response.Body.String())
			}
		})
	}
}

func TestFailedFileOperationsKeepExistingRegistration(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "source.txt", "original")
	destination := t.TempDir()
	writeFileOperationFixture(t, destination, "source.txt", "other")
	entries := newEntryRegistry()
	original := buildFileImageEntry(source, 8)
	entries.remember(original)
	service := newFileService(entries)
	if _, err := service.RenameEntry(source, "source.txt"); err == nil {
		t.Fatal("same path must remain a rejected rename")
	}
	result, err := service.MoveEntries([]string{source}, destination)
	if err != nil || len(result.Failed) != 1 {
		t.Fatalf("expected move conflict: %#v %v", result, err)
	}
	if got, exists := entries.lookup(original.ID); !exists || got.Path != source {
		t.Fatalf("failed operation removed its live registration: %#v %v", got, exists)
	}
}

// Trigger a real source edit once a copy has emitted data. This avoids disk-speed
// assumptions and exercises the interval between the initial Stat and EOF.
type mutateCopySourceContext struct {
	context.Context
	target string
	mutate func()
	fired  bool
}

func (ctx *mutateCopySourceContext) Done() <-chan struct{} {
	if !ctx.fired {
		if info, err := os.Lstat(ctx.target); err == nil && info.Size() > 0 {
			ctx.fired = true
			ctx.mutate()
		}
	}
	return ctx.Context.Done()
}

func TestCopyRegularFileRejectsSourceEditPreservingMetadata(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "source.txt", string(bytes.Repeat([]byte("a"), 65536)))
	before, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	if thumbnailFileIdentity(before) == "" {
		t.Skip("platform does not expose change-time identity")
	}
	target := filepath.Join(root, "copy.txt")
	var mutationErr error
	ctx := &mutateCopySourceContext{Context: context.Background(), target: target}
	ctx.mutate = func() {
		mutationErr = os.WriteFile(source, bytes.Repeat([]byte("b"), 65536), 0600)
		if mutationErr == nil {
			mutationErr = os.Chtimes(source, before.ModTime(), before.ModTime())
		}
	}
	if _, err := copyRegularFile(ctx, source, target); err == nil {
		t.Error("copy reported success after its source changed during reading")
	}
	if mutationErr != nil || !ctx.fired {
		t.Fatalf("source mutation was not exercised: fired=%v error=%v", ctx.fired, mutationErr)
	}
	after, err := os.Stat(source)
	if err != nil || !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		t.Fatalf("fixture changed inode, size or mtime: %v", err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("failed copy left potentially mixed data at its destination: %v", err)
	}
	data, err := os.ReadFile(source)
	if err != nil || !bytes.Equal(data, bytes.Repeat([]byte("b"), 65536)) {
		t.Fatalf("copy damaged the modified original: %v", err)
	}
}

func TestCopyRegularFileRejectsFIFOWithoutWaiting(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("named pipe fixture requires Unix")
	}
	source := filepath.Join(t.TempDir(), "source.txt")
	if output, err := exec.Command("mkfifo", source).CombinedOutput(); err != nil {
		t.Fatalf("mkfifo: %v: %s", err, output)
	}
	target := filepath.Join(t.TempDir(), "target.txt")
	result := make(chan error, 1)
	go func() {
		_, err := copyRegularFile(context.Background(), source, target)
		result <- err
	}()
	select {
	case err := <-result:
		if !errors.Is(err, errNotRegularFile) {
			t.Fatalf("expected non-regular file error, got %v", err)
		}
	case <-time.After(300 * time.Millisecond):
		writer, err := os.OpenFile(source, os.O_RDWR, 0600)
		if err != nil {
			t.Fatal(err)
		}
		_ = writer.Close()
		select {
		case <-result:
		case <-time.After(2 * time.Second):
			t.Fatal("FIFO copy did not stop after writer connected")
		}
		t.Fatal("copy blocked waiting for a FIFO writer")
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("special-file copy created a destination: %v", err)
	}
}

func TestCopyRegularFilePreservesReplacedDestination(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "source.txt", string(bytes.Repeat([]byte("source"), 16384)))
	target := filepath.Join(root, "target.txt")
	replacement := writeFileOperationFixture(t, root, "replacement.txt", "another application's file")
	modified := time.Unix(1600000000, 0)
	if err := os.Chtimes(replacement, modified, modified); err != nil {
		t.Fatal(err)
	}
	var mutationErr error
	ctx := &mutateCopySourceContext{Context: context.Background(), target: target}
	ctx.mutate = func() { mutationErr = os.Rename(replacement, target) }
	_, err := copyRegularFile(ctx, source, target)
	if err == nil || !strings.Contains(err.Error(), "目的地已變更") {
		t.Fatalf("copy must report replacement and preserve it: %v", err)
	}
	if mutationErr != nil || !ctx.fired {
		t.Fatalf("replacement was not exercised: fired=%v error=%v", ctx.fired, mutationErr)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "another application's file" {
		t.Fatalf("copy modified or removed another application's destination: %q %v", data, err)
	}
	info, err := os.Stat(target)
	if err != nil || !info.ModTime().Equal(modified) {
		t.Fatalf("copy changed another application's timestamps: %v", err)
	}
}

func TestMoveFallbackKeepsSourceWhenDestinationDisappears(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "source.txt", "keep the only remaining copy")
	target := filepath.Join(root, "target.txt")
	oldRename := renameFile
	renameFile = func(_, _ string) error { return syscall.EXDEV }
	t.Cleanup(func() { renameFile = oldRename })
	var mutationErr error
	ctx := &mutateCopySourceContext{Context: context.Background(), target: target}
	ctx.mutate = func() { mutationErr = os.Remove(target) }
	if err := moveFileNoReplaceWithContext(ctx, source, target); err == nil {
		t.Error("move reported success after another application removed its destination")
	}
	if mutationErr != nil || !ctx.fired {
		t.Fatalf("destination removal was not exercised: fired=%v error=%v", ctx.fired, mutationErr)
	}
	if data, err := os.ReadFile(source); err != nil || string(data) != "keep the only remaining copy" {
		t.Fatalf("move deleted the only remaining copy after its destination disappeared: %q %v", data, err)
	}
}

func TestCopyRegularFileRollbackOnRepositoryFilesystem(t *testing.T) {
	for _, action := range []string{"cancel", "replace"} {
		t.Run(action, func(t *testing.T) {
			// Exercise the actual checkout filesystem: on macOS ExFAT a new
			// output's inode changes once data blocks have been allocated.
			directory, err := os.MkdirTemp(".", ".fileops-consistency-")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.RemoveAll(directory) })
			source := writeFileOperationFixture(t, t.TempDir(), "source.txt", string(bytes.Repeat([]byte("x"), 65536)))
			target := filepath.Join(directory, "target.txt")
			replacement := writeFileOperationFixture(t, directory, "replacement.txt", "preserve this other file")
			parent, cancel := context.WithCancel(context.Background())
			defer cancel()
			ctx := &mutateCopySourceContext{Context: parent, target: target}
			var mutationErr error
			ctx.mutate = func() {
				allocated, err := os.OpenFile(target, os.O_RDWR, 0600)
				if err != nil {
					mutationErr = err
					return
				}
				mutationErr = allocated.Sync()
				if closeErr := allocated.Close(); mutationErr == nil {
					mutationErr = closeErr
				}
				if mutationErr != nil {
					return
				}
				if action == "cancel" {
					cancel()
				} else {
					mutationErr = os.Rename(replacement, target)
				}
			}
			_, err = copyRegularFile(ctx, source, target)
			if !ctx.fired || mutationErr != nil {
				t.Fatalf("copy interruption was not exercised: fired=%v error=%v", ctx.fired, mutationErr)
			}
			if action == "cancel" {
				if !errors.Is(err, errOperationCancelled) {
					t.Fatalf("expected cancellation: %v", err)
				}
				if _, statErr := os.Lstat(target); !os.IsNotExist(statErr) {
					t.Fatalf("cancellation left a partial output on the repository filesystem: %v", statErr)
				}
			} else {
				if err == nil {
					t.Fatal("copy accepted a replaced destination")
				}
				data, readErr := os.ReadFile(target)
				if readErr != nil || string(data) != "preserve this other file" {
					t.Fatalf("rollback modified another application's file: %q %v", data, readErr)
				}
			}
		})
	}
}
