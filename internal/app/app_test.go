package app

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
)

func TestShouldIgnoreAppleDoubleEntries(t *testing.T) {
	cases := []string{"._AppTest.java", ".DS_Store"}
	for _, name := range cases {
		if !shouldIgnoreEntryName(name) {
			t.Fatalf("expected %q to be ignored", name)
		}
	}
	if shouldIgnoreEntryName("AppTest.java") {
		t.Fatal("normal source file should not be ignored")
	}
	if !shouldIgnoreArchiveEntry("__MACOSX/src/._AppTest.java") {
		t.Fatal("archive AppleDouble entry should be ignored")
	}
}

func TestDecodeUTF8Document(t *testing.T) {
	input := []byte("繁體中文 UTF-8\nこんにちは\nHello")
	if reason := binaryDocumentReason(input); reason != "" {
		t.Fatalf("valid UTF-8 detected as binary: %s", reason)
	}
	if got := decodeDocumentText(input); got != string(input) {
		t.Fatalf("UTF-8 changed: %q", got)
	}
}

func TestNormalizeDocumentLineEndings(t *testing.T) {
	input := []byte("first\r\nsecond\rthird\nfourth")
	if got := decodeDocumentText(input); got != "first\nsecond\nthird\nfourth" {
		t.Fatalf("unexpected normalized line endings: %q", got)
	}
}

func TestDetectAppleDoubleDocument(t *testing.T) {
	input := []byte{0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00}
	if reason := binaryDocumentReason(input); reason == "" {
		t.Fatal("AppleDouble content should be rejected")
	}
}

func TestSeparateExtensionFilters(t *testing.T) {
	images := newExtensionFilter([]string{".png"}, supportedImageExtensions)
	documents := newExtensionFilter([]string{".md"}, supportedDocumentExtensions)
	if !isEnabledExtension(".png", images) || isEnabledExtension(".jpg", images) {
		t.Fatal("image filter did not preserve image selection")
	}
	if !isEnabledExtension(".md", documents) || isEnabledExtension(".txt", documents) {
		t.Fatal("document filter did not preserve document selection")
	}
	if len(newExtensionFilter([]string{}, supportedDocumentExtensions)) != 0 {
		t.Fatal("empty document selection should disable all documents")
	}
	if !isSupportedMedia(".mp4") || entryKind(".mp4") != "video" {
		t.Fatal("video media format was not classified")
	}
	if !isSupportedMedia(".srt") || entryKind(".srt") != "subtitle" {
		t.Fatal("subtitle format was not classified")
	}
	if entryKind(".ts") != "code" {
		t.Fatal("TypeScript extension was misclassified as media")
	}
}

func TestDecodeUTF16Documents(t *testing.T) {
	littleEndian := []byte{0xff, 0xfe, 'A', 0x00, 0x2d, 0x4e}
	if got := decodeDocumentText(littleEndian); got != "A中" {
		t.Fatalf("unexpected UTF-16LE result: %q", got)
	}
	bigEndian := []byte{0xfe, 0xff, 0x00, 'A', 0x4e, 0x2d}
	if got := decodeDocumentText(bigEndian); got != "A中" {
		t.Fatalf("unexpected UTF-16BE result: %q", got)
	}
	if reason := binaryDocumentReason(littleEndian); reason != "" {
		t.Fatalf("UTF-16 document detected as binary: %s", reason)
	}
}

func TestDecodeShiftJISDocument(t *testing.T) {
	encoded, err := japanese.ShiftJIS.NewEncoder().Bytes([]byte("こんにちは、日本語"))
	if err != nil {
		t.Fatal(err)
	}
	if got := decodeDocumentText(encoded); got != "こんにちは、日本語" {
		t.Fatalf("unexpected Shift-JIS result: %q", got)
	}
}

func TestDecodeGB18030Document(t *testing.T) {
	encoded, err := simplifiedchinese.GB18030.NewEncoder().Bytes([]byte("简体中文字幕"))
	if err != nil {
		t.Fatal(err)
	}
	if got := decodeDocumentText(encoded); got != "简体中文字幕" {
		big5Text, _ := traditionalchinese.Big5.NewDecoder().Bytes(encoded)
		gbText, _ := simplifiedchinese.GB18030.NewDecoder().Bytes(encoded)
		t.Logf("GB data: Big5=%q (%d), GB=%q (%d)", string(big5Text), scoreDecodedDocument(string(big5Text)), string(gbText), scoreDecodedDocument(string(gbText)))
		t.Fatalf("unexpected GB18030 result: %q", got)
	}
}

func TestDecodeBig5Document(t *testing.T) {
	encoded, err := traditionalchinese.Big5.NewEncoder().Bytes([]byte("繁體中文字幕"))
	if err != nil {
		t.Fatal(err)
	}
	if got := decodeDocumentText(encoded); got != "繁體中文字幕" {
		big5Text, _ := traditionalchinese.Big5.NewDecoder().Bytes(encoded)
		gbText, _ := simplifiedchinese.GB18030.NewDecoder().Bytes(encoded)
		t.Logf("Big5 data: Big5=%q (%d), GB=%q (%d)", string(big5Text), scoreDecodedDocument(string(big5Text)), string(gbText), scoreDecodedDocument(string(gbText)))
		t.Fatalf("unexpected Big5 result: %q", got)
	}
}

func TestNormalizeLegacyArchiveEntryNames(t *testing.T) {
	name := "[3x3EYES 幻獸之森的遇難者][高田裕三][玉皇朝]Vol.01/cover.png"
	for label, archiveEncoding := range map[string]encoding.Encoding{
		"GBK":  simplifiedchinese.GBK,
		"Big5": traditionalchinese.Big5,
	} {
		encoded, err := archiveEncoding.NewEncoder().Bytes([]byte(name))
		if err != nil {
			t.Fatalf("%s encode failed: %v", label, err)
		}
		if got := normalizeArchiveEntryName(string(encoded)); got != name {
			t.Fatalf("unexpected %s archive name: %q", label, got)
		}
	}
}

func TestLibraryCachePersistence(t *testing.T) {
	cacheRoot := t.TempDir()
	originalUserCacheDir := userCacheDir
	userCacheDir = func() (string, error) { return cacheRoot, nil }
	t.Cleanup(func() { userCacheDir = originalUserCacheDir })

	application := New()
	firstPayload := `{"rootPath":"/library/first","tree":{"id":"first"}}`
	secondPayload := `{"rootPath":"/library/second","tree":{"id":"second"}}`
	if err := application.SaveLibraryCache("/library/first", firstPayload); err != nil {
		t.Fatal(err)
	}
	if err := application.SaveLibraryCache("/library/second", secondPayload); err != nil {
		t.Fatal(err)
	}
	for rootPath, expected := range map[string]string{
		"/library/first":  firstPayload,
		"/library/second": secondPayload,
	} {
		payload, err := application.LoadLibraryCache(rootPath)
		if err != nil {
			t.Fatal(err)
		}
		if payload != expected {
			t.Fatalf("unexpected cache for %s: %q", rootPath, payload)
		}
	}
	missing, err := application.LoadLibraryCache("/library/missing")
	if err != nil {
		t.Fatal(err)
	}
	if missing != "" {
		t.Fatalf("unexpected missing cache payload: %q", missing)
	}
	temporaryFiles, err := filepath.Glob(filepath.Join(cacheRoot, "FastFileViewer", "library-cache-v3", ".library-cache-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(temporaryFiles) != 0 {
		t.Fatalf("temporary cache files remain: %v", temporaryFiles)
	}
}

func TestLibraryCacheRejectsInvalidInput(t *testing.T) {
	cacheRoot := t.TempDir()
	originalUserCacheDir := userCacheDir
	userCacheDir = func() (string, error) { return cacheRoot, nil }
	t.Cleanup(func() { userCacheDir = originalUserCacheDir })

	application := New()
	if err := application.SaveLibraryCache("", "{}"); err == nil {
		t.Fatal("expected empty root path error")
	}
	oversizedPayload := strings.Repeat("x", int(maxLibraryCacheBytes)+1)
	if err := application.SaveLibraryCache("/library", oversizedPayload); err == nil {
		t.Fatal("expected oversized cache error")
	}
}

func TestThumbnailCacheRoundTrip(t *testing.T) {
	cacheRoot := t.TempDir()
	originalUserCacheDir := userCacheDir
	userCacheDir = func() (string, error) { return cacheRoot, nil }
	t.Cleanup(func() { userCacheDir = originalUserCacheDir })

	imagePath := filepath.Join(t.TempDir(), "sample.png")
	if err := os.WriteFile(imagePath, []byte("source"), 0o600); err != nil {
		t.Fatal(err)
	}
	entry := buildFileImageEntry(imagePath, 6)
	cachePath, err := thumbnailCachePath(entry, 280)
	if err != nil {
		t.Fatal(err)
	}
	expected := []byte("cached thumbnail")
	if err := writeThumbnailCache(cachePath, expected); err != nil {
		t.Fatal(err)
	}
	actual, err := readThumbnailCache(cachePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, expected) {
		t.Fatalf("unexpected thumbnail cache: %q", actual)
	}
}

func TestCancelledImageReadStopsImmediately(t *testing.T) {
	imagePath := filepath.Join(t.TempDir(), "sample.png")
	if err := os.WriteFile(imagePath, []byte("not needed"), 0o600); err != nil {
		t.Fatal(err)
	}
	operationCtx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := readEntryLimitedWithContext(operationCtx, buildFileImageEntry(imagePath, 10), 1024)
	if !errors.Is(err, errOperationCancelled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestReadZipEntryHonorsLimit(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "sample.zip")
	writeZipEntry(t, archivePath, "docs/readme.txt", bytes.Repeat([]byte("a"), 1024))
	entry := buildArchiveImageEntry(archivePath, "docs/readme.txt", 0)
	if _, err := readEntryLimited(entry, 100); err == nil {
		t.Fatal("expected archive entry limit error")
	}
}

func TestReadTarGzipEntry(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "sample.tgz")
	writeTarGzipEntry(t, archivePath, "docs/readme.txt", []byte("hello tar"))
	entry := buildArchiveImageEntry(archivePath, "docs/readme.txt", 0)
	data, err := readEntryLimited(entry, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello tar" {
		t.Fatalf("unexpected tar entry: %q", data)
	}
}

func TestScanReportsCorruptArchive(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "broken.tgz"), []byte("not gzip"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := New().ScanDirectory(directory, nil, nil, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Warnings) != 1 {
		t.Fatalf("expected one archive warning, got %v", result.Warnings)
	}
}

func TestScanFindsMediaAndSubtitleEntries(t *testing.T) {
	directory := t.TempDir()
	for _, name := range []string{"clip.mp4", "track.flac", "captions.srt"} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte("placeholder"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	result, err := New().ScanDirectory(directory, nil, nil, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	kinds := make(map[string]string, len(result.Node.Images))
	for _, entry := range result.Node.Images {
		kinds[entry.Name] = entry.Kind
	}
	for name, expectedKind := range map[string]string{
		"clip.mp4":     "video",
		"track.flac":   "audio",
		"captions.srt": "subtitle",
	} {
		if kinds[name] != expectedKind {
			t.Fatalf("unexpected kind for %s: %q", name, kinds[name])
		}
	}
}

func TestMediaExtensionSelectionControlsScan(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "clip.mp4"), []byte("placeholder"), 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := New().ScanDirectory(directory, nil, nil, []string{}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Node.Images) != 0 {
		t.Fatalf("disabled media format should not be scanned: %#v", result.Node.Images)
	}
}

func TestScanFindsMediaInsideArchive(t *testing.T) {
	directory := t.TempDir()
	writeZipEntry(t, filepath.Join(directory, "media.zip"), "clip.mp4", []byte("placeholder"))

	result, err := New().ScanDirectory(directory, nil, nil, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Node.Children) != 1 || len(result.Node.Children[0].Images) != 1 {
		t.Fatalf("expected media entry inside archive: %#v", result.Node.Children)
	}
	entry := result.Node.Children[0].Images[0]
	if entry.Name != "clip.mp4" || entry.Kind != "video" || entry.Source != "archive" {
		t.Fatalf("unexpected archived media entry: %#v", entry)
	}
}

func TestLoadDocumentAcceptsSubtitleAndRejectsPlaybackMedia(t *testing.T) {
	directory := t.TempDir()
	subtitlePath := filepath.Join(directory, "captions.srt")
	if err := os.WriteFile(subtitlePath, []byte("1\n00:00:00,000 --> 00:00:01,000\n字幕"), 0o644); err != nil {
		t.Fatal(err)
	}
	payload, err := New().LoadDocumentByPath(subtitlePath)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Format != ".srt" || !strings.Contains(payload.Text, "字幕") {
		t.Fatalf("unexpected subtitle payload: %#v", payload)
	}

	videoPath := filepath.Join(directory, "clip.mp4")
	if err := os.WriteFile(videoPath, []byte("not a text document"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := New().LoadDocumentByPath(videoPath); err == nil {
		t.Fatal("playback media should not be loaded as a text document")
	}
}

func TestMediaHandlerServesByteRanges(t *testing.T) {
	application := New()
	t.Cleanup(application.cleanupMediaCache)
	mediaPath := filepath.Join(t.TempDir(), "clip.mp4")
	if err := os.WriteFile(mediaPath, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	mediaURL, err := application.PrepareMediaByPath(mediaPath)
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, mediaURL, nil)
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	NewMediaMiddleware(application)(http.NotFoundHandler()).ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent {
		t.Fatalf("unexpected media status: %d", response.Code)
	}
	if response.Body.String() != "2345" {
		t.Fatalf("unexpected media range: %q", response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "video/mp4" {
		t.Fatalf("unexpected media MIME: %q", contentType)
	}
}

func TestMediaHandlerExtractsArchiveEntryForSeeking(t *testing.T) {
	application := New()
	t.Cleanup(application.cleanupMediaCache)
	archivePath := filepath.Join(t.TempDir(), "media.zip")
	writeZipEntry(t, archivePath, "folder/clip.mp4", []byte("archive-media"))
	mediaURL, err := application.PrepareMediaByPath(archivePath + "::folder/clip.mp4")
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, mediaURL, nil)
	request.Header.Set("Range", "bytes=8-12")
	response := httptest.NewRecorder()
	NewMediaMiddleware(application)(http.NotFoundHandler()).ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "media" {
		t.Fatalf("unexpected archived media response: status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestPrepareMediaRejectsDocuments(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "readme.txt")
	if err := os.WriteFile(filePath, []byte("not media"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := New().PrepareMediaByPath(filePath); err == nil {
		t.Fatal("document should not be registered as playback media")
	}
}

func TestCancelledOperationStopsScan(t *testing.T) {
	application := New()
	operationID := application.BeginOperation()
	application.CancelOperation(operationID)
	_, err := application.ScanDirectory(t.TempDir(), nil, nil, nil, operationID)
	if !errors.Is(err, errOperationCancelled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
	application.FinishOperation(operationID)
}

func TestDetectDuplicatesStreamsFiles(t *testing.T) {
	directory := t.TempDir()
	paths := []string{filepath.Join(directory, "first.txt"), filepath.Join(directory, "second.txt"), filepath.Join(directory, "other.txt")}
	contents := [][]byte{[]byte("same"), []byte("same"), []byte("else")}
	entries := make([]ImageEntry, 0, len(paths))
	for index, filePath := range paths {
		if err := os.WriteFile(filePath, contents[index], 0o644); err != nil {
			t.Fatal(err)
		}
		entries = append(entries, buildFileImageEntry(filePath, int64(len(contents[index]))))
	}
	groups, err := New().DetectDuplicates(entries, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 || len(groups[0].Images) != 2 {
		t.Fatalf("unexpected duplicate groups: %#v", groups)
	}
}

func TestCalculateChecksum(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "checksum.txt")
	if err := os.WriteFile(filePath, []byte("FastFileViewer"), 0o644); err != nil {
		t.Fatal(err)
	}
	application := New()
	operationID := application.BeginOperation()
	hash, err := application.CalculateChecksum(buildFileImageEntry(filePath, 10), operationID)
	if err != nil {
		t.Fatal(err)
	}
	if hash != "146d1125433806db02123cf6d9931fd5eda88f76fd825c00d998aae576eb37f8" {
		t.Fatalf("unexpected checksum: %s", hash)
	}
}

func TestValidateImageDimensions(t *testing.T) {
	if err := validateImageDimensions(100, 100); err != nil {
		t.Fatal(err)
	}
	if err := validateImageDimensions(100_000, 100_000); err == nil {
		t.Fatal("expected pixel safety limit error")
	}
}

func writeZipEntry(t *testing.T, archivePath string, entryName string, data []byte) {
	t.Helper()
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create(entryName)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func writeTarGzipEntry(t *testing.T, archivePath string, entryName string, data []byte) {
	t.Helper()
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: entryName, Mode: 0o644, Size: int64(len(data))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}
