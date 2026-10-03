package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestZeroOperationFollowsLibraryLifetime(t *testing.T) {
	application := New().Library
	parent, cancel := context.WithCancel(context.Background())
	application.Startup(parent)
	ordinary := application.operationContext(0)
	id := application.BeginOperation()
	explicit := application.operationContext(id)
	cancel()
	if !errors.Is(checkOperation(ordinary), errOperationCancelled) {
		t.Fatal("operation zero escaped its application context")
	}
	if !errors.Is(checkOperation(explicit), errOperationCancelled) {
		t.Fatal("explicit operation escaped cancellation")
	}
	application.FinishOperation(id)
}

func TestShutdownCancelsAndReleasesRegisteredOperations(t *testing.T) {
	services := New()
	ordinary := services.Library.operationContext(0)
	id := services.Library.BeginOperation()
	explicit := services.Library.operationContext(id)
	services.Shutdown()
	if !errors.Is(checkOperation(ordinary), errOperationCancelled) || !errors.Is(checkOperation(explicit), errOperationCancelled) {
		t.Fatal("shutdown left active operation contexts")
	}
	registry := services.Library.operations
	registry.mu.Lock()
	remaining := len(registry.operations)
	registry.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("shutdown retained %d operation states", remaining)
	}
	late := services.Library.BeginOperation()
	if !errors.Is(checkOperation(services.Library.operationContext(late)), errOperationCancelled) {
		t.Fatal("operation started after shutdown")
	}
	registry.mu.Lock()
	remaining = len(registry.operations)
	registry.mu.Unlock()
	if remaining != 0 {
		t.Fatal("late operation was retained")
	}
}

func TestThumbnailSlotWaitStopsWhenLibraryCloses(t *testing.T) {
	services := New()
	defer services.Shutdown()
	original := thumbnailSlots
	thumbnailSlots = make(chan struct{}, 1)
	thumbnailSlots <- struct{}{}
	defer func() { thumbnailSlots = original }()
	path := filepath.Join(t.TempDir(), "image.svg")
	if err := os.WriteFile(path, []byte("<svg/>"), 0600); err != nil {
		t.Fatal(err)
	}
	completed := make(chan error, 1)
	go func() { _, err := services.Library.LoadThumbnailByPath(path, 280); completed <- err }()
	select {
	case err := <-completed:
		t.Fatalf("did not wait for thumbnail slot: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	services.Shutdown()
	select {
	case err := <-completed:
		if !errors.Is(err, errOperationCancelled) {
			t.Fatalf("unexpected error: %v", err)
		}
	case <-time.After(time.Second):
		<-thumbnailSlots
		<-completed
		t.Fatal("thumbnail remained blocked after shutdown")
	}
}

func TestLibraryReadAPIsRejectClosedLifetime(t *testing.T) {
	services := New()
	directory := t.TempDir()
	imagePath := filepath.Join(directory, "image.svg")
	textPath := filepath.Join(directory, "readme.txt")
	if err := os.WriteFile(imagePath, []byte("<svg/>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(textPath, []byte("text"), 0600); err != nil {
		t.Fatal(err)
	}
	image, err := services.Library.OpenFileByPath(imagePath)
	if err != nil {
		t.Fatal(err)
	}
	services.Shutdown()
	for name, run := range map[string]func() error{
		"document":  func() error { _, err := services.Library.LoadDocumentByPath(textPath); return err },
		"image":     func() error { _, err := services.Library.LoadImage(image.ID); return err },
		"thumbnail": func() error { _, err := services.Library.LoadThumbnailByPath(imagePath, 280); return err },
	} {
		t.Run(name, func(t *testing.T) {
			if err := run(); !errors.Is(err, errOperationCancelled) {
				t.Fatalf("closed app accepted new work: %v", err)
			}
		})
	}
}

func TestThumbnailPixelWaitStopsWhenLibraryCloses(t *testing.T) {
	services := New()
	defer services.Shutdown()
	originalBudget, originalCacheRoot := thumbnailPixels, userCacheDir
	budget := newPixelBudget(maxDecodedImagePixels)
	thumbnailPixels = budget
	cacheRoot := t.TempDir()
	userCacheDir = func() (string, error) { return cacheRoot, nil }
	defer func() { thumbnailPixels, userCacheDir = originalBudget, originalCacheRoot }()
	if err := budget.acquire(context.Background(), budget.limit); err != nil {
		t.Fatal(err)
	}
	held := true
	defer func() {
		if held {
			budget.release(budget.limit)
		}
	}()
	imagePath := filepath.Join(t.TempDir(), "image.png")
	if err := os.WriteFile(imagePath, performancePNG(t), 0600); err != nil {
		t.Fatal(err)
	}
	completed := make(chan error, 1)
	go func() { _, err := services.Library.LoadThumbnailByPath(imagePath, 280); completed <- err }()
	select {
	case err := <-completed:
		t.Fatalf("did not wait for pixel budget: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	services.Shutdown()
	select {
	case err := <-completed:
		if !errors.Is(err, errOperationCancelled) {
			t.Fatalf("unexpected error: %v", err)
		}
	case <-time.After(time.Second):
		budget.release(budget.limit)
		held = false
		<-completed
		t.Fatal("thumbnail pixel wait survived shutdown")
	}
}

func TestOperationRegistryAdoptionCancelsPreviousLifetime(t *testing.T) {
	registry := newOperationRegistry()
	oldRoot := registry.context(0)
	oldID := registry.begin()
	oldOperation := registry.context(oldID)
	registry.adopt(context.Background())
	defer registry.close()
	if oldRoot.Err() == nil || oldOperation.Err() == nil {
		t.Fatal("previous lifetime survived adoption")
	}
	fresh := registry.begin()
	if registry.context(fresh).Err() != nil || registry.context(0).Err() != nil {
		t.Fatal("new lifetime is already cancelled")
	}
	registry.finish(oldID)
	if registry.context(fresh).Err() != nil {
		t.Fatal("old completion cancelled a new operation")
	}
}
