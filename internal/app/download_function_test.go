package app

import (
	"bytes"
	"context"
	"errors"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
)

type functionReader func([]byte) (int, error)

func (read functionReader) Read(data []byte) (int, error) { return read(data) }

type functionWriter func([]byte) (int, error)

func (write functionWriter) Write(data []byte) (int, error) { return write(data) }

func TestDownloadBufferReusePreservesErrorsAndProgress(t *testing.T) {
	buffer := make([]byte, 256*1024)
	for _, event := range []string{"success", "read-error", "write-error", "short-write", "cancel-read", "cancel-write", "limit", "zero-limit"} {
		t.Run(event, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			failure := errors.New("fixture error")
			progress := int64(0)
			readCalls := 0
			reader := functionReader(func(data []byte) (int, error) {
				readCalls++
				if &data[0] != &buffer[0] {
					t.Fatal("caller buffer was not reused")
				}
				if event == "cancel-read" {
					cancel()
				}
				readErr := io.EOF
				if event == "read-error" {
					readErr = failure
				}
				return copy(data, "segment"), readErr
			})
			var output bytes.Buffer
			writer := functionWriter(func(data []byte) (int, error) {
				if event == "write-error" {
					return 0, failure
				}
				if event == "short-write" {
					return 2, nil
				}
				return output.Write(data)
			})
			limit := int64(100)
			if event == "limit" {
				limit = 6
			}
			if event == "zero-limit" {
				limit = 0
			}
			written, err := copyDownloadBodyWithBuffer(ctx, writer, reader, limit, func(delta int64) {
				progress += delta
				if event == "cancel-write" {
					cancel()
				}
			}, buffer)
			if written != progress {
				t.Fatalf("progress %d != written %d", progress, written)
			}
			switch event {
			case "success":
				if err != nil || output.String() != "segment" {
					t.Fatalf("copy: %q, %v", output.String(), err)
				}
			case "read-error", "write-error":
				if !errors.Is(err, failure) {
					t.Fatalf("lost I/O error: %v", err)
				}
			case "short-write":
				if !errors.Is(err, io.ErrShortWrite) || written != 2 {
					t.Fatalf("short write: %d, %v", written, err)
				}
			case "cancel-read", "cancel-write":
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("lost cancellation: %v", err)
				}
				if event == "cancel-read" && written != 0 {
					t.Fatal("wrote after read cancellation")
				}
			case "limit", "zero-limit":
				if err == nil || written != 0 {
					t.Fatal("size limit was not enforced before writing")
				}
				if event == "zero-limit" && readCalls != 0 {
					t.Fatal("read past exhausted limit")
				}
			}
		})
	}
}

func TestHLSBufferReuseAndStableVariantChoice(t *testing.T) {
	large := strings.Repeat("segment-one", 30000)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/master.m3u8":
			_, _ = io.WriteString(w, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=500\nfirst.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=500\ntied.m3u8\n")
		case "/first.m3u8":
			_, _ = io.WriteString(w, "#EXTM3U\n#EXTINF:1,\nlarge.ts\n#EXTINF:1,\nsmall.ts\n#EXT-X-ENDLIST\n")
		case "/large.ts":
			_, _ = io.WriteString(w, large)
		case "/small.ts":
			_, _ = io.WriteString(w, "end")
		default:
			http.Error(w, "wrong variant", http.StatusBadRequest)
		}
	}))
	defer server.Close()
	service := newDownloadTestApp("reuse")
	if err := service.downloadToDirectory(context.Background(), server.Client(), "reuse", server.URL+"/master.m3u8", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	item := service.ListDownloads()[0]
	data, err := os.ReadFile(item.Path)
	if err != nil || string(data) != large+"end" || item.Bytes != int64(len(data)) {
		t.Fatalf("segment output/progress differs: bytes=%d, %v", len(data), err)
	}
}

func TestHLSFunctionParsingCompatibility(t *testing.T) {
	values := []string{"", `BANDWIDTH=10,CODECS="avc1,mp4a",NAME="中文"`, `A=1,A=2,missing,B="unfinished,C=3`, `A=1,,=value, `, "KEY=\xff,OTHER=\u0000"}
	random := rand.New(rand.NewSource(12))
	alphabet := []byte("ABab12=,\" \n\t")
	for range 1000 {
		value := make([]byte, random.Intn(200))
		for index := range value {
			value[index] = alphabet[random.Intn(len(alphabet))]
		}
		values = append(values, string(value))
	}
	for _, value := range values {
		if got, want := parseHLSAttributes(value), referenceParseHLSAttributes(value); !reflect.DeepEqual(got, want) {
			t.Fatalf("attributes differ for %q: %v != %v", value, got, want)
		}
	}
	base, _ := url.Parse("https://example.com/watch/index.html")
	for _, content := range []string{
		`"https:\/\/cdn.example.com\/movie.m3u8?a=1&amp;b=2"`,
		`"https\u003a\u002f\u002fexample.com\x2fmovie.m3u8"`,
		`"//example.com/test.m3u8" '../next.m3u8' "bad.txt"`,
		strings.Repeat(`"https://example.com/duplicate.m3u8" `, 40) + `"different.m3u8"`,
	} {
		if got, want := extractEmbeddedHLSURLs(content, base), referenceExtractEmbeddedHLSURLs(content, base); !reflect.DeepEqual(got, want) {
			t.Fatalf("HLS candidates changed: %v != %v", got, want)
		}
	}
}

func TestRemovedDownloadIDsReleaseTailReferences(t *testing.T) {
	ids := []string{"removed", "keep", "removed", "last"}
	got := removeDownloadID(ids, "removed")
	if !reflect.DeepEqual(got, []string{"keep", "last"}) {
		t.Fatalf("wrong order: %v", got)
	}
	for _, value := range ids[len(got):] {
		if value != "" {
			t.Fatal("removed IDs remain referenced in backing storage")
		}
	}
}

func BenchmarkFunctionDownload(b *testing.B) {
	for _, reuse := range []bool{false, true} {
		name := "before"
		if reuse {
			name = "after"
		}
		b.Run("256-segments/"+name, func(b *testing.B) {
			data := bytes.Repeat([]byte{'x'}, 4096)
			b.ReportAllocs()
			for b.Loop() {
				var buffer []byte
				if reuse {
					buffer = make([]byte, 256*1024)
				}
				for range 256 {
					_, err := copyDownloadBodyWithBuffer(context.Background(), io.Discard, bytes.NewReader(data), 4096, func(int64) {}, buffer)
					if err != nil {
						b.Fatal(err)
					}
				}
			}
		})
	}
	base, _ := url.Parse("https://example.com/watch")
	content := `<script>let source="https:\/\/cdn.example.com\/movie.m3u8?a=1&amp;b=2"</script>`
	for _, impl := range []struct {
		name string
		run  func(string, *url.URL) []string
	}{{"before", referenceExtractEmbeddedHLSURLs}, {"after", extractEmbeddedHLSURLs}} {
		b.Run("embedded-url/"+impl.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				_ = impl.run(content, base)
			}
		})
	}
}
