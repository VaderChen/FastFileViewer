package app

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestCopyRegularFilePreservesPrivateModeAndModificationTime(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "private.txt", "private contents")
	modified := time.Unix(1700000000, 0)
	if err := os.Chtimes(source, modified, modified); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "copied.txt")
	if _, err := copyRegularFile(context.Background(), source, target); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 || !info.ModTime().Equal(modified) {
		t.Fatalf("copy changed private permissions or modification time: %v %v", info.Mode(), info.ModTime())
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "private contents" {
		t.Fatalf("copy contents: %q %v", data, err)
	}
	if _, err := copyRegularFile(context.Background(), source, target); !errors.Is(err, os.ErrExist) {
		t.Fatalf("copy must not overwrite an existing target: %v", err)
	}
}

func TestDuplicateFilePreservesSymbolicLinks(t *testing.T) {
	root := t.TempDir()
	original := writeFileOperationFixture(t, root, "original.txt", "original contents")
	source := filepath.Join(root, "source.txt")
	target := filepath.Join(root, "target.txt")
	if err := os.Symlink(filepath.Base(original), source); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	if err := duplicateFile(source, target); err != nil {
		t.Fatal(err)
	}
	link, err := os.Readlink(target)
	if err != nil || link != filepath.Base(original) {
		t.Fatalf("copy must preserve link text: %q %v", link, err)
	}
	if err := duplicateFile(source, target); !errors.Is(err, os.ErrExist) {
		t.Fatalf("duplicate link must refuse collisions: %v", err)
	}
	data, err := os.ReadFile(original)
	if err != nil || string(data) != "original contents" {
		t.Fatalf("link target changed: %q %v", data, err)
	}
}

func TestMoveFallbackReportsMovedDanglingSymbolicLink(t *testing.T) {
	root := t.TempDir()
	original := writeFileOperationFixture(t, root, "original.txt", "original contents")
	source := filepath.Join(root, "link.txt")
	if err := os.Symlink(filepath.Base(original), source); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	destination := filepath.Join(root, "destination")
	if err := os.Mkdir(destination, 0700); err != nil {
		t.Fatal(err)
	}
	oldRename := renameFile
	renameFile = func(_, _ string) error { return syscall.EXDEV }
	t.Cleanup(func() { renameFile = oldRename })
	result, err := New().File.MoveEntries([]string{source}, destination)
	if err != nil || len(result.Moved) != 1 || len(result.Failed) != 0 {
		t.Fatalf("completed symlink move was reported as failed: %+v %v", result, err)
	}
	target := filepath.Join(destination, "link.txt")
	link, err := os.Readlink(target)
	if err != nil || link != filepath.Base(original) {
		t.Fatalf("move dereferenced the link: %q %v", link, err)
	}
	if _, err := os.Lstat(source); !os.IsNotExist(err) {
		t.Fatalf("source link remains after move: %v", err)
	}
	if data, err := os.ReadFile(original); err != nil || string(data) != "original contents" {
		t.Fatalf("moving the link modified its referent: %q %v", data, err)
	}
}

func TestCopyRegularFileRejectsDanglingDestinationLink(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "source.txt", "private")
	referent := filepath.Join(root, "missing.txt")
	target := filepath.Join(root, "target.txt")
	if err := os.Symlink(referent, target); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	if _, err := copyRegularFile(context.Background(), source, target); !errors.Is(err, os.ErrExist) {
		t.Fatalf("dangling target link must be treated as a collision: %v", err)
	}
	if _, err := os.Lstat(referent); !os.IsNotExist(err) {
		t.Fatalf("copy wrote through a destination symlink: %v", err)
	}
}

func TestMoveFallbackRollsBackWhenSourceCannotBeRemoved(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root bypasses directory write permissions")
	}
	root := t.TempDir()
	sourceDirectory := filepath.Join(root, "read-only")
	source := writeFileOperationFixture(t, sourceDirectory, "source.txt", "source")
	target := filepath.Join(root, "target.txt")
	if err := os.Chmod(sourceDirectory, 0500); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(sourceDirectory, 0700)
	oldRename := renameFile
	renameFile = func(_, _ string) error { return syscall.EXDEV }
	t.Cleanup(func() { renameFile = oldRename })
	err := moveFileNoReplace(source, target)
	if err == nil {
		t.Fatal("moving out of a read-only source directory should fail")
	}
	if data, err := os.ReadFile(source); err != nil || string(data) != "source" {
		t.Fatalf("failed removal must leave the source intact: %q %v", data, err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("failed move did not roll back its target: %v", err)
	}
}

func TestFileRollbackPreservesReplacedDestination(t *testing.T) {
	root := t.TempDir()
	target := writeFileOperationFixture(t, root, "target.txt", "our copy")
	oldFile, err := os.Open(target)
	if err != nil {
		t.Fatal(err)
	}
	defer oldFile.Close()
	originalInfo, err := oldFile.Stat()
	if err != nil {
		t.Fatal(err)
	}
	replacement := writeFileOperationFixture(t, root, "replacement.txt", "another document")
	if err := os.Rename(replacement, target); err != nil {
		t.Fatal(err)
	}
	if err := removeFileIfSame(target, originalInfo); err == nil {
		t.Fatal("rollback should report that the destination changed")
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "another document" {
		t.Fatalf("rollback removed a replacement file: %q %v", data, err)
	}
}

func TestDuplicateFileCancellationLeavesNoDestination(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "source.txt", "source")
	target := filepath.Join(root, "target.txt")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := duplicateFileWithContext(ctx, source, target); !errors.Is(err, errOperationCancelled) {
		t.Fatalf("expected cancellation: %v", err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("cancelled operation created a destination: %v", err)
	}
}

// The controlled context cancels when copying starts, after exclusive creation.
// It makes the partial-file cleanup test independent of disk speed.
type cancelCopyContext struct {
	context.Context
	once   sync.Once
	done   chan struct{}
	target string
}

func (ctx *cancelCopyContext) Done() <-chan struct{} {
	if info, err := os.Lstat(ctx.target); err == nil && info.Size() > 0 {
		ctx.once.Do(func() { close(ctx.done) })
	}
	return ctx.done
}

func TestCopyRegularFileCancellationRemovesIncompleteDestination(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "source.txt", string(bytes.Repeat([]byte("source"), 32768)))
	target := filepath.Join(root, "target.txt")
	ctx := &cancelCopyContext{Context: context.Background(), done: make(chan struct{}), target: target}
	if _, err := copyRegularFile(ctx, source, target); !errors.Is(err, errOperationCancelled) {
		t.Fatalf("expected cancellation while copying: %v", err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("cancelled copy left an incomplete destination: %v", err)
	}
	if data, err := os.ReadFile(source); err != nil || len(data) != 6*32768 {
		t.Fatalf("cancelled copy changed the original: %q %v", data, err)
	}
}

func TestMoveFileAcrossActualVolumes(t *testing.T) {
	// On the development checkout the repository and temporary directory are
	// different volumes. Skip this integration case on single-volume hosts.
	sourceDirectory, err := os.MkdirTemp(".", "fileops-cross-volume-")
	if err != nil {
		t.Skipf("checkout is read-only: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(sourceDirectory) })
	source := writeFileOperationFixture(t, sourceDirectory, "source.txt", "cross-volume contents")
	modified := time.Unix(1700000000, 0)
	if err := os.Chtimes(source, modified, modified); err != nil {
		t.Fatal(err)
	}
	sourceInfo, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	targetDirectory := t.TempDir()
	probe := filepath.Join(targetDirectory, "link-probe.txt")
	if err := os.Link(source, probe); err == nil {
		_ = os.Remove(probe)
		t.Skip("checkout and temporary directory support a direct hard link")
	} else if !errors.Is(err, syscall.EXDEV) {
		t.Skipf("cannot confirm distinct volumes: %v", err)
	}
	target := filepath.Join(targetDirectory, "target.txt")
	if err := moveFileNoReplace(source, target); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(target); err != nil || string(data) != "cross-volume contents" {
		t.Fatalf("cross-volume contents: %q %v", data, err)
	}
	if _, err := os.Lstat(source); !os.IsNotExist(err) {
		t.Fatalf("source remains after completed cross-volume move: %v", err)
	}
	targetInfo, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if targetInfo.Mode().Perm() != sourceInfo.Mode().Perm() || !targetInfo.ModTime().Equal(sourceInfo.ModTime()) {
		t.Fatalf("cross-volume move changed mode or mtime: %v %v", targetInfo.Mode(), targetInfo.ModTime())
	}
}

func TestDuplicateFileCancellationRollsBackCompletedLink(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "source.txt", "source")
	target := filepath.Join(root, "target.txt")
	ctx := &cancelCopyContext{Context: context.Background(), done: make(chan struct{}), target: target}
	if err := duplicateFileWithContext(ctx, source, target); !errors.Is(err, errOperationCancelled) {
		t.Fatalf("expected cancellation after creating a link: %v", err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("cancelled duplicate left a destination: %v", err)
	}
	if data, err := os.ReadFile(source); err != nil || string(data) != "source" {
		t.Fatalf("link rollback changed the original: %q %v", data, err)
	}
}

func TestMoveFileCancellationRollsBackCopyAndKeepsSource(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "source.txt", "source")
	target := filepath.Join(root, "target.txt")
	ctx := &cancelCopyContext{Context: context.Background(), done: make(chan struct{}), target: target}
	oldRename := renameFile
	renameFile = func(_, _ string) error { return syscall.EXDEV }
	t.Cleanup(func() { renameFile = oldRename })
	if err := moveFileNoReplaceWithContext(ctx, source, target); !errors.Is(err, errOperationCancelled) {
		t.Fatalf("expected cancellation before removing the source: %v", err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("cancelled move left a destination: %v", err)
	}
	if data, err := os.ReadFile(source); err != nil || string(data) != "source" {
		t.Fatalf("cancelled move changed the original: %q %v", data, err)
	}
}

func TestTrashCancellationRollsBackCopyAndKeepsSource(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	source := writeFileOperationFixture(t, t.TempDir(), "source.txt", "source")
	target := filepath.Join(home, ".Trash", "source.txt")
	ctx := &cancelCopyContext{Context: context.Background(), done: make(chan struct{}), target: target}
	oldRename := renameFile
	renameFile = func(_, _ string) error { return syscall.EXDEV }
	t.Cleanup(func() { renameFile = oldRename })
	if err := moveToTrashWithContext(ctx, source); !errors.Is(err, errOperationCancelled) {
		t.Fatalf("expected cancellation before removing the source: %v", err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("cancelled trash move left a destination: %v", err)
	}
	if data, err := os.ReadFile(source); err != nil || string(data) != "source" {
		t.Fatalf("cancelled trash move changed the original: %q %v", data, err)
	}
}

func TestCommittedTrashMoveSucceedsWhenContextIsCancelled(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	source := writeFileOperationFixture(t, t.TempDir(), "source.txt", "source")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	oldRename := renameFile
	renameFile = func(from, to string) error {
		err := oldRename(from, to)
		if err == nil {
			cancel()
		}
		return err
	}
	t.Cleanup(func() { renameFile = oldRename })
	if err := moveToTrashWithContext(ctx, source); err != nil {
		t.Fatalf("completed move must return success despite cancellation: %v", err)
	}
	if _, err := os.Lstat(source); !os.IsNotExist(err) {
		t.Fatalf("committed move left the source: %v", err)
	}
	target := filepath.Join(home, ".Trash", "source.txt")
	if data, err := os.ReadFile(target); err != nil || string(data) != "source" {
		t.Fatalf("committed trash move lost contents: %q %v", data, err)
	}
	if ctx.Err() == nil {
		t.Fatal("native rename did not exercise cancellation after commit")
	}
}
