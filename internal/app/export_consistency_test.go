package app

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExportCancellationCleansAllocatedRepositoryFile(t *testing.T) {
	directory, err := os.MkdirTemp(".", ".export-consistency-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	source := writeFileOperationFixture(t, t.TempDir(), "source.txt", string(bytes.Repeat([]byte("x"), 65536)))
	target := filepath.Join(directory, "export.txt")
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
		cancel()
	}
	err = copyEntryToFile(ctx, buildFileImageEntry(source, 65536), target)
	if !ctx.fired || mutationErr != nil {
		t.Fatalf("allocated export cancellation was not exercised: fired=%v error=%v", ctx.fired, mutationErr)
	}
	if !errors.Is(err, errOperationCancelled) {
		t.Fatalf("expected export cancellation, got %v", err)
	}
	if _, statErr := os.Lstat(target); !os.IsNotExist(statErr) {
		t.Fatalf("cancelled export left its allocated output on the repository filesystem: %v", statErr)
	}
}

func TestExportDetectsReplacedRepositoryDestination(t *testing.T) {
	for _, shouldCancel := range []bool{false, true} {
		name := "finished copy"
		if shouldCancel {
			name = "cancelled copy"
		}
		t.Run(name, func(t *testing.T) {
			directory, err := os.MkdirTemp(".", ".export-consistency-")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.RemoveAll(directory) })
			source := writeFileOperationFixture(t, t.TempDir(), "source.txt", string(bytes.Repeat([]byte("x"), 65536)))
			target := filepath.Join(directory, "export.txt")
			replacement := writeFileOperationFixture(t, directory, "replacement.txt", "another application's output")
			parent, cancel := context.WithCancel(context.Background())
			defer cancel()
			ctx := &mutateCopySourceContext{Context: parent, target: target}
			var mutationErr error
			ctx.mutate = func() {
				mutationErr = os.Rename(replacement, target)
				if shouldCancel {
					cancel()
				}
			}
			err = copyEntryToFile(ctx, buildFileImageEntry(source, 65536), target)
			if !ctx.fired || mutationErr != nil {
				t.Fatalf("export replacement was not exercised: fired=%v error=%v", ctx.fired, mutationErr)
			}
			if err == nil || !strings.Contains(err.Error(), "目的地已變更") {
				t.Fatalf("export must report a replaced destination, got %v", err)
			}
			if shouldCancel && !errors.Is(err, errOperationCancelled) {
				t.Fatalf("export lost its cancellation result: %v", err)
			}
			data, readErr := os.ReadFile(target)
			if readErr != nil || string(data) != "another application's output" {
				t.Fatalf("export changed or removed the replacement: %q %v", data, readErr)
			}
		})
	}
}
