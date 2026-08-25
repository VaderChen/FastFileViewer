package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPlanRemuxKeepsPlayableVideoWithoutTranscoding(t *testing.T) {
	for name, expected := range map[string]struct {
		codecs mediaCodecs
		plan   remuxPlan
	}{
		"h264 與 aac 完全免轉碼": {
			codecs: mediaCodecs{video: "h264", audio: "aac"},
			plan:   remuxPlan{extension: ".mp4", format: "mp4", videoCodec: "copy", audioCodec: "copy"},
		},
		"h264 搭配 ac3 只重編音訊": {
			codecs: mediaCodecs{video: "h264", audio: "ac3"},
			plan:   remuxPlan{extension: ".mp4", format: "mp4", videoCodec: "copy", audioCodec: "aac"},
		},
		"hevc 需要 hvc1 標籤": {
			codecs: mediaCodecs{video: "hevc", audio: "aac"},
			plan:   remuxPlan{extension: ".mp4", format: "mp4", videoCodec: "copy", audioCodec: "copy", videoTag: "hvc1"},
		},
		"vp9 與 opus 改封裝成 WebM": {
			codecs: mediaCodecs{video: "vp9", audio: "opus"},
			plan:   remuxPlan{extension: ".webm", format: "webm", videoCodec: "copy", audioCodec: "copy"},
		},
		"av1 搭配 ac3 只重編音訊": {
			codecs: mediaCodecs{video: "av1", audio: "ac3"},
			plan:   remuxPlan{extension: ".webm", format: "webm", videoCodec: "copy", audioCodec: "libopus"},
		},
		"沒有音軌時不需要音訊編碼器": {
			codecs: mediaCodecs{video: "h264"},
			plan:   remuxPlan{extension: ".mp4", format: "mp4", videoCodec: "copy", audioCodec: "copy"},
		},
		"Xvid 無法直接播放才重編畫面": {
			codecs: mediaCodecs{video: "mpeg4", audio: "mp3"},
			plan:   remuxPlan{extension: ".mp4", format: "mp4", videoCodec: "h264_videotoolbox", audioCodec: "aac", transcodesVideo: true},
		},
	} {
		if plan := planRemux(expected.codecs); plan != expected.plan {
			t.Fatalf("%s: 預期 %#v，實際 %#v", name, expected.plan, plan)
		}
	}
}

func TestRemuxArgumentsMatchPlan(t *testing.T) {
	copyArguments := strings.Join(remuxArguments("in.mkv", "out.mp4", planRemux(mediaCodecs{video: "hevc", audio: "aac"})), " ")
	for _, expected := range []string{"-c:v copy", "-c:a copy", "-tag:v hvc1", "-movflags +faststart", "-f mp4 out.mp4"} {
		if !strings.Contains(copyArguments, expected) {
			t.Fatalf("改封裝參數缺少 %q: %s", expected, copyArguments)
		}
	}
	if strings.Contains(copyArguments, "-b:v") {
		t.Fatalf("改封裝不應設定畫面位元率: %s", copyArguments)
	}

	webmArguments := strings.Join(remuxArguments("in.mkv", "out.webm", planRemux(mediaCodecs{video: "vp9", audio: "opus"})), " ")
	if !strings.Contains(webmArguments, "-f webm out.webm") || strings.Contains(webmArguments, "faststart") {
		t.Fatalf("WebM 改封裝參數不正確: %s", webmArguments)
	}

	transcodeArguments := strings.Join(remuxArguments("in.mkv", "out.mp4", transcodeRemuxPlan()), " ")
	if !strings.Contains(transcodeArguments, "-c:v h264_videotoolbox -b:v 8M") {
		t.Fatalf("重編碼參數不正確: %s", transcodeArguments)
	}
}

func TestParseProbedCodecsTakesFirstTrackOfEachKind(t *testing.T) {
	codecs, err := parseProbedCodecs([]byte(`{"streams":[
		{"codec_type":"subtitle","codec_name":"ass"},
		{"codec_type":"video","codec_name":"h264"},
		{"codec_type":"audio","codec_name":"ac3"},
		{"codec_type":"audio","codec_name":"aac"}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	if codecs.video != "h264" || codecs.audio != "ac3" {
		t.Fatalf("未取到第一條視訊與音訊軌: %#v", codecs)
	}
	if _, err := parseProbedCodecs([]byte(`{"streams":[{"codec_type":"audio","codec_name":"aac"}]}`)); err == nil {
		t.Fatal("沒有視訊軌時應回報錯誤")
	}
}

func TestRemuxFormatsRequireConversion(t *testing.T) {
	for _, extension := range []string{".mkv", ".avi", ".m2ts", ".MKV"} {
		if !requiresVideoRemux(extension) {
			t.Fatalf("%s 應該需要改封裝", extension)
		}
	}
	for _, extension := range []string{".mp4", ".mov", ".m4v", ".webm"} {
		if requiresVideoRemux(extension) {
			t.Fatalf("%s 可以直接播放，不應改封裝", extension)
		}
	}
}

func TestPrepareMKVCopiesStreamsWhenCodecsArePlayable(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "ffmpeg.log")
	stubFFmpeg(t, logPath, "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})

	media := New().Media
	t.Cleanup(media.cleanup)
	playablePath := prepareVideo(t, media, "movie.mkv")
	if filepath.Ext(playablePath) != ".mp4" {
		t.Fatalf("預期改封裝成 MP4: %s", playablePath)
	}

	invocations := readLog(t, logPath)
	if len(invocations) != 1 {
		t.Fatalf("可直接複製時只該呼叫一次 ffmpeg: %#v", invocations)
	}
	if !strings.Contains(invocations[0], "-c:v copy") || !strings.Contains(invocations[0], "-c:a copy") {
		t.Fatalf("兩軌都應直接複製: %s", invocations[0])
	}
}

func TestPrepareMKVUsesWebMForVP9(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "vp9", audio: "opus"})

	media := New().Media
	t.Cleanup(media.cleanup)
	playablePath := prepareVideo(t, media, "clip.mkv")
	if filepath.Ext(playablePath) != ".webm" {
		t.Fatalf("VP9 應改封裝成 WebM: %s", playablePath)
	}
	if mediaMIMEByExtension(filepath.Ext(playablePath)) != "video/webm" {
		t.Fatalf("WebM 快取的 MIME 不正確: %s", playablePath)
	}
}

func TestPrepareMKVFallsBackToTranscodeWhenRemuxFails(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "ffmpeg.log")
	stubFFmpeg(t, logPath, "-c:v copy")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})

	media := New().Media
	t.Cleanup(media.cleanup)
	playablePath := prepareVideo(t, media, "broken.mkv")

	invocations := readLog(t, logPath)
	if len(invocations) != 2 {
		t.Fatalf("改封裝失敗後應改用重編碼: %#v", invocations)
	}
	if !strings.Contains(invocations[1], "-c:v h264_videotoolbox") {
		t.Fatalf("第二次嘗試應改用重編碼: %s", invocations[1])
	}
	payload, err := os.ReadFile(playablePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != "playable-media" {
		t.Fatalf("重編碼結果沒有寫入快取: %q", payload)
	}
	if entries, err := filepath.Glob(filepath.Join(filepath.Dir(playablePath), "*.part")); err != nil || len(entries) != 0 {
		t.Fatalf("失敗的暫存檔沒有清除: %#v", entries)
	}
}

func TestPrepareMKVWithoutProbeStillCopiesVideo(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "ffmpeg.log")
	stubFFmpeg(t, logPath, "")
	originalProbe := probeMediaCodecsFunc
	probeMediaCodecsFunc = func(context.Context, string) (mediaCodecs, error) {
		return mediaCodecs{}, fmt.Errorf("找不到 ffprobe")
	}
	t.Cleanup(func() { probeMediaCodecsFunc = originalProbe })

	media := New().Media
	t.Cleanup(media.cleanup)
	prepareVideo(t, media, "unknown.mkv")

	invocations := readLog(t, logPath)
	if !strings.Contains(invocations[0], "-c:v copy") || !strings.Contains(invocations[0], "-c:a aac") {
		t.Fatalf("沒有 ffprobe 時應保守地複製畫面並重編音訊: %s", invocations[0])
	}
}

// stubFFmpeg 會安裝假的 ffmpeg：參數含 failurePattern 時失敗，否則寫出播放快取。
func stubFFmpeg(t *testing.T, logPath string, failurePattern string) {
	t.Helper()
	failure := ""
	if failurePattern != "" {
		failure = fmt.Sprintf("case \"$*\" in\n  *%q*) echo \"remux failed\" >&2; exit 1;;\nesac\n", failurePattern)
	}
	script := fmt.Sprintf("#!/bin/sh\nprintf '%%s\\n' \"$*\" >> %q\n%sfor argument do output=\"$argument\"; done\nprintf playable-media > \"$output\"\n", logPath, failure)
	executable := filepath.Join(t.TempDir(), "ffmpeg")
	if err := os.WriteFile(executable, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	originalFinder := findFFmpegExecutable
	findFFmpegExecutable = func() (string, error) { return executable, nil }
	t.Cleanup(func() { findFFmpegExecutable = originalFinder })
}

func stubProbedCodecs(t *testing.T, codecs mediaCodecs) {
	t.Helper()
	originalProbe := probeMediaCodecsFunc
	probeMediaCodecsFunc = func(context.Context, string) (mediaCodecs, error) { return codecs, nil }
	t.Cleanup(func() { probeMediaCodecsFunc = originalProbe })
}

func prepareVideo(t *testing.T, media *MediaService, name string) string {
	t.Helper()
	videoPath := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(videoPath, []byte("source-video"), 0o600); err != nil {
		t.Fatal(err)
	}
	mediaURL, err := media.PrepareMediaByPath(videoPath, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(mediaURL, mediaURLPrefix) {
		t.Fatalf("非預期的媒體網址: %s", mediaURL)
	}
	media.cacheMu.Lock()
	defer media.cacheMu.Unlock()
	for _, cachedPath := range media.cacheFiles {
		return cachedPath
	}
	t.Fatalf("沒有建立播放快取: %s", name)
	return ""
}

func readLog(t *testing.T, logPath string) []string {
	t.Helper()
	payload, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSpace(string(payload)), "\n")
}

func TestReleasePlaybackCacheRemovesTemporaryCopyOnly(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})

	media := New().Media
	t.Cleanup(media.cleanup)
	videoPath := writeVideo(t, "movie.mkv")
	cachedPath := prepareVideoAt(t, media, videoPath)

	if err := media.ReleasePlaybackCache(videoPath); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cachedPath); !os.IsNotExist(err) {
		t.Fatalf("暫存播放檔沒有釋放: %s", cachedPath)
	}
	if _, err := os.Stat(videoPath); err != nil {
		t.Fatalf("釋放暫存不得動到使用者原檔: %v", err)
	}
	media.cacheMu.Lock()
	remaining := len(media.cacheFiles)
	media.cacheMu.Unlock()
	if remaining != 0 {
		t.Fatalf("快取索引沒有清除: %d", remaining)
	}
}

func TestReplaceOriginalWithRemuxTrashesSourceAndKeepsPlayableCopy(t *testing.T) {
	trashHome := t.TempDir()
	t.Setenv("HOME", trashHome)
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})

	media := New().Media
	t.Cleanup(media.cleanup)
	videoPath := writeVideo(t, "movie.mkv")
	cachedPath := prepareVideoAt(t, media, videoPath)

	entry, err := entryByPath(videoPath)
	if err != nil {
		t.Fatal(err)
	}
	targetPath := filepath.Join(filepath.Dir(videoPath), "movie.mp4")
	replacement, err := media.replaceOriginalWithRemux(entry, cachedPath, targetPath)
	if err != nil {
		t.Fatal(err)
	}
	if replacement.Path != targetPath || replacement.Name != "movie.mp4" || replacement.Kind != "video" || replacement.Format != ".mp4" {
		t.Fatalf("回傳的取代項目不正確: %#v", replacement)
	}
	if replacement.ID == entry.ID || replacement.ID != hashID("file", targetPath) {
		t.Fatalf("取代項目的 ID 應與重新掃描結果一致: %#v", replacement)
	}

	if payload, err := os.ReadFile(targetPath); err != nil || string(payload) != "playable-media" {
		t.Fatalf("改封裝結果沒有保存在原資料夾: %v %q", err, payload)
	}
	if _, err := os.Stat(videoPath); !os.IsNotExist(err) {
		t.Fatalf("原始影片應該已經移到垃圾桶: %v", err)
	}
	if payload, err := os.ReadFile(filepath.Join(trashHome, ".Trash", "movie.mkv")); err != nil || string(payload) != "source-video" {
		t.Fatalf("垃圾桶內找不到原始影片: %v %q", err, payload)
	}
	if _, err := os.Stat(cachedPath); !os.IsNotExist(err) {
		t.Fatalf("保存後應釋放暫存複本: %s", cachedPath)
	}

	// 保存到原資料夾的檔案是唯一的可播放版本，不能再被暫存釋放流程刪掉。
	if err := media.ReleasePlaybackCache(targetPath); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(targetPath); err != nil {
		t.Fatalf("已保存的影片被誤刪: %v", err)
	}
	media.cacheMu.Lock()
	cachedAfterRelease := media.cacheFiles[entry.ID]
	media.cacheMu.Unlock()
	if cachedAfterRelease != targetPath {
		t.Fatalf("快取索引沒有指向保存後的檔案: %q", cachedAfterRelease)
	}
}

func TestReplaceOriginalWithRemuxRollsBackWhenTrashFails(t *testing.T) {
	trashHome := t.TempDir()
	t.Setenv("HOME", trashHome)
	// 讓 ~/.Trash 是一般檔案，垃圾桶目錄就無法建立。
	if err := os.WriteFile(filepath.Join(trashHome, ".Trash"), []byte("not-a-directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})

	media := New().Media
	t.Cleanup(media.cleanup)
	videoPath := writeVideo(t, "movie.mkv")
	cachedPath := prepareVideoAt(t, media, videoPath)
	entry, err := entryByPath(videoPath)
	if err != nil {
		t.Fatal(err)
	}

	targetPath := filepath.Join(filepath.Dir(videoPath), "movie.mp4")
	if _, err := media.replaceOriginalWithRemux(entry, cachedPath, targetPath); err == nil {
		t.Fatal("垃圾桶搬移失敗時應回報錯誤")
	}
	if _, err := os.Stat(targetPath); !os.IsNotExist(err) {
		t.Fatalf("失敗時不應留下半成品: %v", err)
	}
	if _, err := os.Stat(videoPath); err != nil {
		t.Fatalf("失敗時原始影片必須保留: %v", err)
	}
	if _, err := os.Stat(cachedPath); err != nil {
		t.Fatalf("失敗時播放快取必須保留: %v", err)
	}
}

func TestClaimRemuxPromptOnlyAsksOnce(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})

	media := New().Media
	t.Cleanup(media.cleanup)
	videoPath := writeVideo(t, "movie.mkv")
	prepareVideoAt(t, media, videoPath)
	entry, err := entryByPath(videoPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := media.claimRemuxPrompt(entry.ID); !ok {
		t.Fatal("第一次應該要詢問")
	}
	if _, ok := media.claimRemuxPrompt(entry.ID); ok {
		t.Fatal("同一個檔案不應重複詢問")
	}
}

func TestAvailableTrashPathAvoidsOverwriting(t *testing.T) {
	trashDirectory := t.TempDir()
	if err := os.WriteFile(filepath.Join(trashDirectory, "movie.mkv"), []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	if candidate := availableTrashPath(trashDirectory, "movie.mkv"); filepath.Base(candidate) != "movie 1.mkv" {
		t.Fatalf("同名檔案應該改名: %s", candidate)
	}
}

func writeVideo(t *testing.T, name string) string {
	t.Helper()
	videoPath := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(videoPath, []byte("source-video"), 0o600); err != nil {
		t.Fatal(err)
	}
	return videoPath
}

func prepareVideoAt(t *testing.T, media *MediaService, videoPath string) string {
	t.Helper()
	if _, err := media.PrepareMediaByPath(videoPath, 0); err != nil {
		t.Fatal(err)
	}
	media.cacheMu.Lock()
	defer media.cacheMu.Unlock()
	for _, cachedPath := range media.cacheFiles {
		return cachedPath
	}
	t.Fatalf("沒有建立播放快取: %s", videoPath)
	return ""
}

func TestPrepareRunsDifferentMediaConcurrently(t *testing.T) {
	stubFFmpeg(t, filepath.Join(t.TempDir(), "ffmpeg.log"), "")
	// 探測期間卡住，藉此檢查不同檔案的準備工作不會互相等待。
	started := make(chan string, 2)
	release := make(chan struct{})
	originalProbe := probeMediaCodecsFunc
	probeMediaCodecsFunc = func(_ context.Context, sourcePath string) (mediaCodecs, error) {
		started <- sourcePath
		<-release
		return mediaCodecs{video: "h264", audio: "aac"}, nil
	}
	t.Cleanup(func() { probeMediaCodecsFunc = originalProbe })

	media := New().Media
	t.Cleanup(media.cleanup)
	prepared := make(chan error, 2)
	for _, name := range []string{"first.mkv", "second.mkv"} {
		videoPath := writeVideo(t, name)
		go func() {
			_, err := media.PrepareMediaByPath(videoPath, 0)
			prepared <- err
		}()
	}

	for range 2 {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			close(release)
			t.Fatal("不同影片的準備工作被串行化了")
		}
	}
	close(release)
	for range 2 {
		if err := <-prepared; err != nil {
			t.Fatal(err)
		}
	}
}

func TestPrepareMediaSkipsWorkWhenOperationIsAlreadyCancelled(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "ffmpeg.log")
	stubFFmpeg(t, logPath, "")
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})

	services := New()
	t.Cleanup(services.Media.cleanup)
	operationID := services.Library.BeginOperation()
	services.Library.CancelOperation(operationID)
	media := services.Media

	_, err := media.PrepareMediaByPath(writeVideo(t, "movie.mkv"), operationID)
	if !errors.Is(err, errOperationCancelled) {
		t.Fatalf("已取消的操作應直接中止: %v", err)
	}
	if _, statErr := os.Stat(logPath); !os.IsNotExist(statErr) {
		t.Fatal("已取消的操作不應啟動 ffmpeg")
	}
}

func TestCancellingPreparationStopsFFmpegWithoutTranscodeFallback(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "ffmpeg.log")
	// 用 exec 讓被終止的行程就是這個 sleep，模擬 ffmpeg 直接作為子行程的情況。
	script := fmt.Sprintf("#!/bin/sh\nprintf '%%s\\n' \"$*\" >> %q\nexec sleep 30\n", logPath)
	executable := filepath.Join(t.TempDir(), "ffmpeg")
	if err := os.WriteFile(executable, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	originalFinder := findFFmpegExecutable
	findFFmpegExecutable = func() (string, error) { return executable, nil }
	t.Cleanup(func() { findFFmpegExecutable = originalFinder })
	stubProbedCodecs(t, mediaCodecs{video: "h264", audio: "aac"})

	services := New()
	t.Cleanup(services.Media.cleanup)
	operationID := services.Library.BeginOperation()
	media := services.Media
	prepared := make(chan error, 1)
	go func() {
		_, err := media.PrepareMediaByPath(writeVideo(t, "movie.mkv"), operationID)
		prepared <- err
	}()

	waitForFFmpegInvocations(t, logPath, 1)
	services.Library.CancelOperation(operationID)
	select {
	case err := <-prepared:
		if !errors.Is(err, errOperationCancelled) {
			t.Fatalf("取消操作時應回報已取消: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("取消操作沒有中止 ffmpeg")
	}
	if invocations := readLog(t, logPath); len(invocations) != 1 {
		t.Fatalf("取消後不應再嘗試重編碼: %#v", invocations)
	}
}

func waitForFFmpegInvocations(t *testing.T, logPath string, expected int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if payload, err := os.ReadFile(logPath); err == nil {
			if len(strings.Split(strings.TrimSpace(string(payload)), "\n")) >= expected {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("等不到 ffmpeg 被呼叫 %d 次", expected)
}
