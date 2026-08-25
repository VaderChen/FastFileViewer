package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDownloadURLRejectsPrivateNetworks(t *testing.T) {
	for _, rawURL := range []string{
		"http://127.0.0.1/file",
		"http://10.0.0.1/file",
		"http://169.254.169.254/latest/meta-data",
		"http://[::1]/file",
		"http://localhost/file",
	} {
		if _, err := validatePublicDownloadURL(context.Background(), rawURL); err == nil {
			t.Fatalf("expected private URL to be rejected: %s", rawURL)
		}
	}
	if !isPublicDownloadAddress(netip.MustParseAddr("1.1.1.1")) {
		t.Fatal("public address should be accepted")
	}
	if isPublicDownloadAddress(netip.MustParseAddr("100.64.0.1")) {
		t.Fatal("carrier-grade NAT address should be rejected")
	}
	if isPublicDownloadAddress(netip.MustParseAddr("::ffff:127.0.0.1")) {
		t.Fatal("IPv4-mapped loopback address should be rejected")
	}
}

func TestDownloadRedirectRejectsPrivateDestination(t *testing.T) {
	client := newSafeDownloadClient()
	request, err := http.NewRequest(http.MethodGet, "http://127.0.0.1/private", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.CheckRedirect(request, []*http.Request{{}}); err == nil {
		t.Fatal("expected redirect to private destination to be rejected")
	}
}

func TestDownloadDirectFileAndContentDisposition(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "image/png")
		response.Header().Set("Content-Disposition", `attachment; filename="sample image.png"`)
		_, _ = response.Write([]byte("png-data"))
	}))
	defer server.Close()

	application := newDownloadTestApp("direct")
	directory := t.TempDir()
	if err := application.downloadToDirectory(context.Background(), server.Client(), "direct", server.URL+"/asset", directory); err != nil {
		t.Fatal(err)
	}
	item := application.ListDownloads()[0]
	if item.Name != "sample image.png" || item.ContentType != "image/png" {
		t.Fatalf("unexpected download metadata: %#v", item)
	}
	payload, err := os.ReadFile(item.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != "png-data" {
		t.Fatalf("unexpected downloaded payload: %q", payload)
	}
}

func TestDownloadHLSMasterPlaylist(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/master.m3u8":
			response.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = io.WriteString(response, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=500\nhigh.m3u8\n")
		case "/high.m3u8":
			_, _ = io.WriteString(response, "#EXTM3U\n#EXTINF:1,\nhigh-1.ts\n#EXTINF:1,\nhigh-2.ts\n#EXT-X-ENDLIST\n")
		case "/low.m3u8":
			_, _ = io.WriteString(response, "#EXTM3U\n#EXTINF:1,\nlow.ts\n#EXT-X-ENDLIST\n")
		case "/high-1.ts":
			_, _ = io.WriteString(response, "high-one")
		case "/high-2.ts":
			_, _ = io.WriteString(response, "high-two")
		case "/low.ts":
			_, _ = io.WriteString(response, "low")
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	application := newDownloadTestApp("hls")
	if err := application.downloadToDirectory(context.Background(), server.Client(), "hls", server.URL+"/master.m3u8", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	item := application.ListDownloads()[0]
	if filepath.Ext(item.Path) != ".m2ts" {
		t.Fatalf("expected MPEG-TS download extension, got %s", item.Path)
	}
	payload, err := os.ReadFile(item.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != "high-onehigh-two" {
		t.Fatalf("unexpected HLS payload: %q", payload)
	}
}

func TestExtractEmbeddedHLSURLs(t *testing.T) {
	baseURL := mustParseDownloadURL(t, "https://example.com/videos/demo/")
	content := `<script>
const primary = "https:\/\/cdn.example.com\/hls\/master.m3u8?token=a&amp;quality=high";
const backup = '//media.example.com/backup.m3u8';
const relative = '../local/stream.m3u8?key=value';
</script>`
	urls := extractEmbeddedHLSURLs(content, baseURL)
	expected := []string{
		"https://cdn.example.com/hls/master.m3u8?token=a&quality=high",
		"https://media.example.com/backup.m3u8",
		"https://example.com/videos/local/stream.m3u8?key=value",
	}
	if len(urls) != len(expected) {
		t.Fatalf("unexpected HLS URL count: %#v", urls)
	}
	for index := range expected {
		if urls[index] != expected[index] {
			t.Fatalf("unexpected HLS URL at %d: %q", index, urls[index])
		}
	}
}

func TestDownloadWebPageResolvesSingleHLS(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/videos/demo/":
			response.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = fmt.Fprintf(response, `<html><script>const source="%s\/stream\/master.m3u8?token=secret";</script></html>`, strings.ReplaceAll(server.URL, "/", `\/`))
		case "/stream/master.m3u8":
			if request.Referer() != server.URL+"/videos/demo/" {
				t.Errorf("unexpected HLS referer: %q", request.Referer())
			}
			if request.Header.Get("Origin") != server.URL {
				t.Errorf("unexpected HLS origin: %q", request.Header.Get("Origin"))
			}
			_, _ = io.WriteString(response, "#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n")
		case "/stream/segment.ts":
			if request.Referer() != server.URL+"/videos/demo/" {
				t.Errorf("unexpected segment referer: %q", request.Referer())
			}
			_, _ = io.WriteString(response, "video-data")
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	application := newDownloadTestApp("page")
	if err := application.downloadToDirectory(context.Background(), server.Client(), "page", server.URL+"/videos/demo/", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	item := application.ListDownloads()[0]
	if item.Name != "demo.m2ts" {
		t.Fatalf("unexpected resolved download name: %q", item.Name)
	}
	payload, err := os.ReadFile(item.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(payload) != "video-data" {
		t.Fatalf("unexpected resolved HLS payload: %q", payload)
	}
}

func TestResolveDownloadPageReturnsMultipleHLSCandidates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(response, `<script>const streams=["/first.m3u8","/second.m3u8"];</script>`)
	}))
	defer server.Close()

	parsedURL := mustParseDownloadURL(t, server.URL+"/videos/multi/")
	resolution, err := resolveDownloadPage(context.Background(), server.Client(), parsedURL)
	if err != nil {
		t.Fatal(err)
	}
	if resolution.Name != "multi" || len(resolution.Candidates) != 2 {
		t.Fatalf("unexpected page resolution: %#v", resolution)
	}
	application := newDownloadTestApp("multi")
	err = application.downloadToDirectory(context.Background(), server.Client(), "multi", parsedURL.String(), t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "user selection") {
		t.Fatalf("expected multiple-stream selection error, got %v", err)
	}
}

func TestDownloadWebPageFallsBackToHTML(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(response, "<html><body>No video here</body></html>")
	}))
	defer server.Close()

	application := newDownloadTestApp("article")
	if err := application.downloadToDirectory(context.Background(), server.Client(), "article", server.URL+"/article", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	item := application.ListDownloads()[0]
	if filepath.Ext(item.Path) != ".html" {
		t.Fatalf("expected HTML fallback, got %s", item.Path)
	}
}

func TestDownloadRequestSanitizesSourceHeaders(t *testing.T) {
	request, err := newDownloadRequest(context.Background(), "https://cdn.example.com/master.m3u8", "https://example.com/watch?token=secret#fragment")
	if err != nil {
		t.Fatal(err)
	}
	if request.Referer() != "https://example.com/watch" || request.Header.Get("Origin") != "https://example.com" {
		t.Fatalf("unexpected source headers: referer=%q origin=%q", request.Referer(), request.Header.Get("Origin"))
	}
	redirect, err := http.NewRequestWithContext(request.Context(), http.MethodGet, "https://1.1.1.1/playlist.m3u8", nil)
	if err != nil {
		t.Fatal(err)
	}
	redirect.Header.Set("Referer", "https://cdn.example.com/master.m3u8?temporary=token")
	if err := newSafeDownloadClient().CheckRedirect(redirect, []*http.Request{request}); err != nil {
		t.Fatal(err)
	}
	if redirect.Referer() != "https://example.com/watch" || redirect.Header.Get("Origin") != "https://example.com" {
		t.Fatalf("source headers were not preserved across redirect: referer=%q origin=%q", redirect.Referer(), redirect.Header.Get("Origin"))
	}
}

func TestHLSRejectsEncryptedAndLivePlaylists(t *testing.T) {
	baseURL := mustParseDownloadURL(t, "https://example.com/video/index.m3u8")
	if _, err := parseHLSPlaylist("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\nsegment.ts\n#EXT-X-ENDLIST\n", baseURL); err == nil {
		t.Fatal("encrypted HLS playlist should be rejected")
	}
	playlist, err := parseHLSPlaylist("#EXTM3U\n#EXTINF:1,\nsegment.ts\n", baseURL)
	if err != nil {
		t.Fatal(err)
	}
	if playlist.Ended {
		t.Fatal("live playlist should not be marked as completed")
	}
}

func TestHLSByteRangeParsing(t *testing.T) {
	rangeHeader, nextOffset, err := hlsByteRange("10@5", 0)
	if err != nil || rangeHeader != "bytes=5-14" || nextOffset != 15 {
		t.Fatalf("unexpected explicit byte range: %q, %d, %v", rangeHeader, nextOffset, err)
	}
	rangeHeader, nextOffset, err = hlsByteRange("4", nextOffset)
	if err != nil || rangeHeader != "bytes=15-18" || nextOffset != 19 {
		t.Fatalf("unexpected implicit byte range: %q, %d, %v", rangeHeader, nextOffset, err)
	}
}

func TestCopyDownloadBodyHonorsLimitAndCancellation(t *testing.T) {
	var destination bytes.Buffer
	if _, err := copyDownloadBody(context.Background(), &destination, strings.NewReader("123456"), 5, func(int64) {}); err == nil {
		t.Fatal("expected size limit error")
	}
	cancelledContext, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := copyDownloadBody(cancelledContext, io.Discard, strings.NewReader("data"), 10, func(int64) {}); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestDownloadFilenameSanitization(t *testing.T) {
	name := sanitizeDownloadName("../../private/evil:name.png")
	if name != "evil_name.png" {
		t.Fatalf("unexpected sanitized filename: %q", name)
	}
	directory := t.TempDir()
	tempFile, err := os.CreateTemp(directory, ".download-*.part")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tempFile.WriteString("safe"); err != nil {
		t.Fatal(err)
	}
	if err := tempFile.Close(); err != nil {
		t.Fatal(err)
	}
	path, err := commitDownloadedFile(tempFile.Name(), directory, "../outside.txt")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(path) != directory {
		t.Fatalf("download escaped destination: %s", path)
	}
}

func TestDownloadHistoryURLRedaction(t *testing.T) {
	resourceURL := mustParseDownloadURL(t, "https://example.com/video.m3u8?token=secret#fragment")
	if got := redactedDownloadURL(resourceURL); got != "https://example.com/video.m3u8" {
		t.Fatalf("unexpected redacted URL: %s", got)
	}
}

func TestDownloadHistoryPersistence(t *testing.T) {
	configDirectory := t.TempDir()
	originalConfigDirectory := downloadUserConfigDir
	downloadUserConfigDir = func() (string, error) { return configDirectory, nil }
	t.Cleanup(func() { downloadUserConfigDir = originalConfigDirectory })

	application := New().Download
	application.downloads["saved"] = &DownloadItem{ID: "saved", URL: "https://example.com/file", Name: "file", Status: "downloading", CreatedAt: 1}
	application.downloadOrder = []string{"saved"}
	if err := application.persistDownloads(); err != nil {
		t.Fatal(err)
	}
	reloaded := New().Download
	reloaded.loadDownloads()
	items := reloaded.ListDownloads()
	if len(items) != 1 || items[0].Status != "failed" || !strings.Contains(items[0].Error, "interrupted") {
		t.Fatalf("unexpected restored history: %#v", items)
	}
}

func newDownloadTestApp(id string) *DownloadService {
	application := New().Download
	application.downloads[id] = &DownloadItem{ID: id, URL: "https://example.com", Name: "download", Status: "downloading"}
	application.downloadOrder = []string{id}
	return application
}

func mustParseDownloadURL(t *testing.T, rawURL string) *url.URL {
	t.Helper()
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	return parsedURL
}
