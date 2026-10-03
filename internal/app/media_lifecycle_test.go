package app

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReleasePlaybackCacheWaitsForPendingPreparation(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	entered := make(chan struct{})
	proceed := make(chan struct{})
	originalProbe := probeMediaCodecsFunc
	probeMediaCodecsFunc = func(ctx context.Context, _ string) (mediaCodecs, error) {
		close(entered)
		select {
		case <-proceed:
			return mediaCodecs{video: "h264", audio: "aac"}, nil
		case <-ctx.Done():
			return mediaCodecs{}, ctx.Err()
		}
	}
	t.Cleanup(func() { probeMediaCodecsFunc = originalProbe })
	media := New().Media
	t.Cleanup(media.cleanup)
	path := writeVideo(t, "pending.mkv")
	prepared := make(chan error, 1)
	go func() { _, err := media.PrepareMediaByPath(path, 0); prepared <- err }()
	<-entered
	released := make(chan error, 1)
	go func() { released <- media.ReleasePlaybackCache(path) }()
	early := false
	select {
	case err := <-released:
		early = true
		if err != nil {
			t.Error(err)
		}
	case <-time.After(100 * time.Millisecond):
	}
	close(proceed)
	if err := <-prepared; err != nil {
		t.Fatal(err)
	}
	if !early {
		if err := <-released; err != nil {
			t.Fatal(err)
		}
	}
	media.cacheMu.Lock()
	remaining := len(media.cacheFiles)
	media.cacheMu.Unlock()
	if early || remaining != 0 {
		t.Fatalf("release returned before preparation completed; early=%v remaining=%d", early, remaining)
	}
}

func TestMediaCleanupCancelsPendingPreparationAndAllowsReuse(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	entered := make(chan struct{})
	stopped := make(chan struct{})
	escape := make(chan struct{})
	originalProbe := probeMediaCodecsFunc
	probeMediaCodecsFunc = func(ctx context.Context, _ string) (mediaCodecs, error) {
		close(entered)
		select {
		case <-ctx.Done():
			close(stopped)
			return mediaCodecs{}, ctx.Err()
		case <-escape:
			return mediaCodecs{}, errors.New("test released probe")
		}
	}
	t.Cleanup(func() { probeMediaCodecsFunc = originalProbe })
	media := New().Media
	t.Cleanup(media.cleanup)
	path := writeVideo(t, "pending.mkv")
	prepared := make(chan error, 1)
	go func() { _, err := media.PrepareMediaByPath(path, 0); prepared <- err }()
	<-entered
	media.cacheMu.Lock()
	oldDirectory := media.cacheDir
	media.cacheMu.Unlock()
	cleaned := make(chan struct{})
	go func() { media.cleanup(); close(cleaned) }()
	cancelled := false
	select {
	case <-stopped:
		cancelled = true
	case <-time.After(time.Second):
	}
	close(escape)
	<-cleaned
	if err := <-prepared; err == nil {
		t.Error("cancelled preparation unexpectedly succeeded")
	}
	if !cancelled {
		t.Error("cleanup did not cancel active preparation")
	}
	if _, err := os.Stat(oldDirectory); !os.IsNotExist(err) {
		t.Errorf("old cache remains: %v", err)
	}
	media.cacheMu.Lock()
	remaining := len(media.cacheFiles)
	media.cacheMu.Unlock()
	if remaining != 0 {
		t.Errorf("cleanup left %d cache entries", remaining)
	}
	probeMediaCodecsFunc = func(context.Context, string) (mediaCodecs, error) {
		return mediaCodecs{video: "h264", audio: "aac"}, nil
	}
	if _, err := media.PrepareMediaByPath(path, 0); err != nil {
		t.Fatalf("service cannot be reused after cleanup: %v", err)
	}
}

func TestCompatibleArchiveAudioPreservesOriginalPlaybackCache(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	archivePath := filepath.Join(t.TempDir(), "audio.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entryWriter, err := writer.Create("track.wav")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entryWriter.Write([]byte("original audio")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	entry := ImageEntry{ID: hashID("archive", archivePath, "track.wav"), Name: "track.wav", Path: archivePath + "::track.wav", Source: "archive", ArchivePath: archivePath, InnerPath: "track.wav", Format: ".wav", Kind: "audio"}
	media := New().Media
	t.Cleanup(media.cleanup)
	original, err := media.seekableMediaPath(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := media.compatibleAudioPath(context.Background(), entry); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(original)
	if err != nil || string(content) != "original audio" {
		t.Fatalf("compatible conversion destroyed original playback cache: %q %v", content, err)
	}
}

func TestSaveRemuxRejectsChangedSource(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})
	media := New().Media
	t.Cleanup(media.cleanup)
	path := writeVideo(t, "changed.mkv")
	cached := prepareVideoAt(t, media, path)
	entry, err := entryByPath(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("newer original video content"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(filepath.Dir(path), "changed.mp4")
	if _, err := media.replaceOriginalWithRemux(entry, cached, target); err == nil {
		t.Error("saved obsolete conversion over changed source")
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "newer original video content" {
		t.Errorf("modified source was moved or changed: %q %v", data, err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Errorf("obsolete target remains: %v", err)
	}
}

func TestCancelledMediaPreparationDoesNotWaitForItemLock(t *testing.T) {
	media := New().Media
	t.Cleanup(media.cleanup)
	entry, err := entryByPath(writeVideo(t, "locked.mkv"))
	if err != nil {
		t.Fatal(err)
	}
	lock, err := media.acquireMediaPrepareLock(context.Background(), entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan error, 1)
	go func() { _, err := media.seekableMediaPath(ctx, entry); finished <- err }()
	cancel()
	select {
	case err := <-finished:
		if !errors.Is(err, errOperationCancelled) {
			t.Errorf("unexpected cancellation error: %v", err)
		}
	case <-time.After(time.Second):
		media.releaseMediaPrepareLock(entry.ID, lock)
		<-finished
		t.Fatal("cancelled preparation remained blocked on item lock")
	}
	media.releaseMediaPrepareLock(entry.ID, lock)
	media.prepareMu.Lock()
	remaining := len(media.prepareLocks)
	media.prepareMu.Unlock()
	if remaining != 0 {
		t.Errorf("unused preparation locks retained: %d", remaining)
	}
}

func TestMediaCleanupStopsRunningFFmpeg(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "ffmpeg.log")
	script := fmt.Sprintf("#!/bin/sh\nprintf started > %q\nexec sleep 30\n", logPath)
	executable := filepath.Join(t.TempDir(), "ffmpeg")
	if err := os.WriteFile(executable, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	originalFinder := findFFmpegExecutable
	findFFmpegExecutable = func() (string, error) { return executable, nil }
	t.Cleanup(func() { findFFmpegExecutable = originalFinder })
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})
	media := New().Media
	t.Cleanup(media.cleanup)
	path := writeVideo(t, "running.mkv")
	prepared := make(chan error, 1)
	go func() { _, err := media.PrepareMediaByPath(path, 0); prepared <- err }()
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := os.Stat(logPath); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("fake FFmpeg did not start")
		}
		time.Sleep(5 * time.Millisecond)
	}
	cleaned := make(chan struct{})
	go func() { media.cleanup(); close(cleaned) }()
	select {
	case <-cleaned:
	case <-time.After(3 * time.Second):
		t.Fatal("cleanup did not stop FFmpeg promptly")
	}
	if err := <-prepared; !errors.Is(err, errOperationCancelled) {
		t.Errorf("unexpected preparation result after cleanup: %v", err)
	}
}

func TestOpenedMediaRemainsReadableAfterCacheRelease(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})
	media := New().Media
	t.Cleanup(media.cleanup)
	path := writeVideo(t, "active.mkv")
	prepareVideoAt(t, media, path)
	entry, err := entryByPath(path)
	if err != nil {
		t.Fatal(err)
	}
	file, cachedPath, err := media.openMediaFile(context.Background(), entry)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := media.ReleasePlaybackCache(path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cachedPath); !os.IsNotExist(err) {
		t.Errorf("cache was not released: %v", err)
	}
	data, err := io.ReadAll(file)
	if err != nil || string(data) != "playable-media" {
		t.Errorf("active stream lost its file: %q %v", data, err)
	}
}

func TestSaveRemuxSerializesWithPlaybackCacheRelease(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})
	media := New().Media
	t.Cleanup(media.cleanup)
	path := writeVideo(t, "saving.mkv")
	cached := prepareVideoAt(t, media, path)
	entry, err := entryByPath(path)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(filepath.Dir(path), "saving.mp4")
	saving := make(chan struct{})
	proceed := make(chan struct{})
	originalRename := renameFile
	renameFile = func(source, target string) error {
		close(saving)
		<-proceed
		return originalRename(source, target)
	}
	t.Cleanup(func() { renameFile = originalRename })
	saved := make(chan error, 1)
	go func() { _, err := media.replaceOriginalWithRemux(entry, cached, target); saved <- err }()
	<-saving
	released := make(chan error, 1)
	go func() { released <- media.ReleasePlaybackCache(path) }()
	early := false
	select {
	case err := <-released:
		early = true
		if err != nil {
			t.Error(err)
		}
	case <-time.After(100 * time.Millisecond):
	}
	close(proceed)
	if err := <-saved; err != nil {
		t.Fatal(err)
	}
	if !early {
		if err := <-released; err != nil {
			t.Fatal(err)
		}
	}
	if early {
		t.Error("cache release ran during remux save")
	}
	if data, err := os.ReadFile(target); err != nil || string(data) != "playable-media" {
		t.Errorf("saved media was not preserved: %q %v", data, err)
	}
	if path, ok := media.lookupMediaCache(entry.ID); !ok || path != target {
		t.Errorf("old playback URL lost its saved alias: %q %v", path, ok)
	}
}

func TestResetLibraryCancelsPreparationBeforeClearingEntries(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	entered := make(chan struct{})
	originalProbe := probeMediaCodecsFunc
	probeMediaCodecsFunc = func(ctx context.Context, _ string) (mediaCodecs, error) {
		close(entered)
		<-ctx.Done()
		return mediaCodecs{}, ctx.Err()
	}
	t.Cleanup(func() { probeMediaCodecsFunc = originalProbe })
	services := New()
	t.Cleanup(services.Media.cleanup)
	path := writeVideo(t, "reset.mkv")
	entry, err := entryByPath(path)
	if err != nil {
		t.Fatal(err)
	}
	services.Media.entries.remember(entry)
	prepared := make(chan error, 1)
	go func() { _, err := services.Media.PrepareMediaByPath(path, 0); prepared <- err }()
	<-entered
	finished := make(chan struct{})
	go func() { services.Library.ResetLibrary(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(3 * time.Second):
		t.Fatal("ResetLibrary deadlocked with active preparation")
	}
	if err := <-prepared; !errors.Is(err, errOperationCancelled) {
		t.Errorf("ResetLibrary failed to cancel preparation: %v", err)
	}
	if _, exists := services.Media.entries.lookup(entry.ID); exists {
		t.Error("old preparation repopulated the cleared library")
	}
	services.Media.cacheMu.Lock()
	remaining := len(services.Media.cacheFiles)
	cacheDirectory := services.Media.cacheDir
	services.Media.cacheMu.Unlock()
	if remaining != 0 || cacheDirectory != "" {
		t.Errorf("reset retained playback cache: entries=%d directory=%q", remaining, cacheDirectory)
	}
}
