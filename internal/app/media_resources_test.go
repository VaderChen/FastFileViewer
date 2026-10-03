package app

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func rewriteMediaPreservingMetadata(t *testing.T, path string, replacement []byte) {
	t.Helper()
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if thumbnailFileIdentity(before) == "" {
		t.Skip("platform does not expose change-time identity")
	}
	if int64(len(replacement)) != before.Size() {
		t.Fatal("replacement must preserve source byte count")
	}
	if err := os.WriteFile(path, replacement, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) ||
		thumbnailFileIdentity(before) == thumbnailFileIdentity(after) {
		t.Fatal("fixture must retain inode and mtime but change filesystem change time")
	}
}

func TestMediaCacheRefreshesAfterRewriteWithPreservedModificationTime(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "ffmpeg.log")
	stubFFmpeg(t, logPath, "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})
	media := New().Media
	t.Cleanup(media.cleanup)
	sourcePath := writeVideo(t, "edited.mkv")
	prepareVideoAt(t, media, sourcePath)
	rewriteMediaPreservingMetadata(t, sourcePath, []byte("edited-video"))
	prepareVideoAt(t, media, sourcePath)
	if invocations := readLog(t, logPath); len(invocations) != 2 {
		t.Fatalf("rewritten source reused obsolete remux: %d conversions", len(invocations))
	}
}

func TestSaveRemuxRejectsRewriteWithPreservedModificationTime(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})
	media := New().Media
	t.Cleanup(media.cleanup)
	sourcePath := writeVideo(t, "edited.mkv")
	cached := prepareVideoAt(t, media, sourcePath)
	entry, err := entryByPath(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	rewriteMediaPreservingMetadata(t, sourcePath, []byte("edited-video"))
	target := filepath.Join(filepath.Dir(sourcePath), "edited.mp4")
	if _, err := media.replaceOriginalWithRemux(entry, cached, target); err == nil {
		t.Fatal("saved obsolete conversion of changed source")
	}
	if data, err := os.ReadFile(sourcePath); err != nil || string(data) != "edited-video" {
		t.Fatalf("modified source not preserved: %q %v", data, err)
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("obsolete target exists: %v", err)
	}
}

func TestReleasePlaybackCacheAfterSourceDisappears(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})
	for _, scenario := range []string{"video removed", "audio removed", "video replaced by directory", "archive removed"} {
		t.Run(scenario, func(t *testing.T) {
			media := New().Media
			t.Cleanup(media.cleanup)
			sourcePath := filepath.Join(t.TempDir(), "movie.mkv")
			if scenario == "audio removed" {
				sourcePath = filepath.Join(filepath.Dir(sourcePath), "audio.wma")
			}
			content := []byte("source-video")
			if scenario == "archive removed" {
				sourcePath = filepath.Join(filepath.Dir(sourcePath), "media.zip")
				content = archiveWithSingleEntry(t, "zip", "movie.mp4", "archived video")
			}
			if err := os.WriteFile(sourcePath, content, 0600); err != nil {
				t.Fatal(err)
			}
			playbackPath := sourcePath
			if scenario == "archive removed" {
				playbackPath += "::movie.mp4"
			}
			if _, err := media.PrepareMediaByPath(playbackPath, 0); err != nil {
				t.Fatal(err)
			}
			cached := make([]string, 0, len(media.cacheFiles))
			for _, path := range media.cacheFiles {
				cached = append(cached, path)
			}
			if len(cached) == 0 {
				t.Fatal("fixture produced no playback cache")
			}
			if err := os.Remove(sourcePath); err != nil {
				t.Fatal(err)
			}
			if scenario == "video replaced by directory" {
				if err := os.Mkdir(sourcePath, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if err := media.ReleasePlaybackCache(playbackPath); err != nil {
				t.Fatal(err)
			}
			if len(media.cacheFiles) != 0 || len(media.cacheSources) != 0 {
				t.Fatal("orphaned playback cache remains registered")
			}
			for _, path := range cached {
				if _, err := os.Stat(path); !os.IsNotExist(err) {
					t.Fatalf("orphaned playback file remains: %s %v", path, err)
				}
			}
		})
	}
}

func TestReleasePlaybackCacheRetainsRemovalFailuresForRetry(t *testing.T) {
	media := New().Media
	t.Cleanup(media.cleanup)
	directory, err := media.ensureMediaCacheDir()
	if err != nil {
		t.Fatal(err)
	}
	source := writeVideo(t, "retry.mkv")
	entry, err := entryByPath(source)
	if err != nil {
		t.Fatal(err)
	}
	blocked := filepath.Join(directory, "blocked.mp4")
	if err := os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	child := filepath.Join(blocked, "external-file")
	if err := os.WriteFile(child, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	media.cacheFiles[entry.ID] = blocked
	if err := media.ReleasePlaybackCache(source); err == nil {
		t.Fatal("release hid a failed filesystem removal")
	}
	if media.cacheFiles[entry.ID] != blocked {
		t.Fatal("failed removal discarded cache index, preventing retry")
	}
	if err := os.Remove(child); err != nil {
		t.Fatal(err)
	}
	if err := media.ReleasePlaybackCache(source); err != nil {
		t.Fatal(err)
	}
	if len(media.cacheFiles) != 0 {
		t.Fatal("successful retry retained cache index")
	}
}

func TestMediaCommandBoundsLargeDiagnosticOutput(t *testing.T) {
	command := exec.Command("/bin/sh", "-c", "printf diagnostic; dd if=/dev/zero bs=1024 count=256 2>/dev/null; printf final-error >&2; exit 1")
	output, err := runMediaCommand(command)
	if err == nil {
		t.Fatal("lost failing FFmpeg exit status")
	}
	if len(output) != maxMediaDiagnosticBytes || !bytes.Contains(output, []byte("diagnostic")) {
		t.Fatalf("unexpected diagnostic prefix length %d", len(output))
	}
}

func TestProbeCodecsRejectsOversizeOutput(t *testing.T) {
	executable := filepath.Join(t.TempDir(), "ffprobe")
	// Valid JSON followed by whitespace remains valid JSON even when it is far too large.
	script := "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\"}]}'\ndd if=/dev/zero bs=1024 count=1025 2>/dev/null | tr '\\000' ' '\n"
	if err := os.WriteFile(executable, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	originalFinder := findFFprobeExecutable
	findFFprobeExecutable = func() (string, error) { return executable, nil }
	t.Cleanup(func() { findFFprobeExecutable = originalFinder })
	if _, err := probeMediaCodecs(context.Background(), "source.mkv"); err == nil || !strings.Contains(err.Error(), "大小上限") {
		t.Fatalf("oversize probe output was not rejected: %v", err)
	}
	// The same process path still accepts ordinary probe metadata.
	script = strings.Split(script, "\ndd ")[0] + "\n"
	if err := os.WriteFile(executable, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	if codecs, err := probeMediaCodecs(context.Background(), "source.mkv"); err != nil || codecs.video != "h264" {
		t.Fatalf("ordinary probe metadata rejected: %#v %v", codecs, err)
	}
}

func TestRemuxCommitFailureRemovesPartialOutput(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})
	media := New().Media
	directory := t.TempDir()
	finalPath := filepath.Join(directory, "blocked.mp4")
	if err := os.Mkdir(finalPath, 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(finalPath, "preserve")
	if err := os.WriteFile(marker, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := media.remuxToPlayableContainer(context.Background(), writeVideo(t, "source.mkv"), "blocked", directory)
	if err == nil || !strings.Contains(err.Error(), "完成影片播放快取失敗") {
		t.Fatalf("expected failed remux commit: %v", err)
	}
	if _, err := os.Stat(finalPath + ".part"); !os.IsNotExist(err) {
		t.Fatalf("failed remux left a partial output: %v", err)
	}
	if data, err := os.ReadFile(marker); err != nil || string(data) != "keep" {
		t.Fatalf("destination was changed: %q %v", data, err)
	}
}

func TestReleasePlaybackCachePreservesSavedAliasAfterOriginalRemoved(t *testing.T) {
	media := New().Media
	t.Cleanup(media.cleanup)
	if _, err := media.ensureMediaCacheDir(); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(t.TempDir(), "original.mkv")
	saved := filepath.Join(filepath.Dir(original), "original.mp4")
	if err := os.WriteFile(saved, []byte("saved output"), 0600); err != nil {
		t.Fatal(err)
	}
	entryID := hashID("file", original)
	media.cacheFiles[entryID] = saved
	if err := media.ReleasePlaybackCache(original); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(saved); err != nil || string(data) != "saved output" || media.cacheFiles[entryID] != saved {
		t.Fatalf("saved alias was removed: data=%q err=%v", data, err)
	}
}
