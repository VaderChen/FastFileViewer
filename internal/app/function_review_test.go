package app

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/VaderChen/FastFileViewer/internal/updater"
)

func comparePlaylistParsers(t *testing.T, content string) {
	t.Helper()
	base, _ := url.Parse("https://example.test/media/master.m3u8?session=example")
	got, gotErr := parseHLSPlaylist(content, base)
	want, wantErr := referenceParseHLSPlaylist(content, base)
	if fmt.Sprint(gotErr) != fmt.Sprint(wantErr) || !reflect.DeepEqual(got, want) {
		t.Fatalf("playlist parsers differ for %d bytes: errors %v / %v, segments %d / %d", len(content), gotErr, wantErr, len(got.Segments), len(want.Segments))
	}
}

func TestPlaylistParserParity(t *testing.T) {
	bodies := []string{
		"", "#EXTM3U", "invalid", " \t#EXTM3U\n",
		"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,CODECS=\"a,b\"\nsmall.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200\nbig.m3u8\n",
		"#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXT-X-MAP:URI=\"init.mp4\",BYTERANGE=\"20@0\"\n#EXT-X-BYTERANGE:5@20\nmedia.mp4\n#EXT-X-BYTERANGE:8\nmedia.mp4\n#EXT-X-ENDLIST",
		"#EXTM3U\n#EXT-X-BYTERANGE:5@0\none.ts\n#EXT-X-BYTERANGE:8\ntwo.ts\n",
		"#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\nsegment.ts\n",
		"#EXTM3U\nhttp://%zz\n", "#EXTM3U\n#comment\n \u00a0\nsegment.ts?name=%E4%B8%AD\n",
	}
	for _, body := range bodies {
		for _, text := range []string{body, body + "\n", strings.ReplaceAll(body, "\n", "\r\n")} {
			comparePlaylistParsers(t, text)
		}
	}
	// Match the Scanner's buffer boundary and final-line behavior exactly.
	for _, size := range []int{65535, 65536, 65537, int(maxDownloadMetadataBytes) - 1, int(maxDownloadMetadataBytes)} {
		line := "#" + strings.Repeat("x", size-1)
		for _, ending := range []string{"", "\n"} {
			comparePlaylistParsers(t, "#EXTM3U\n"+line+ending)
		}
	}
}

func FuzzPlaylistParserParity(f *testing.F) {
	for _, value := range []string{"#EXTM3U\nclip.ts\n#EXT-X-ENDLIST", "#EXTM3U\r\n#EXT-X-KEY:METHOD=NONE\r\na.ts", "#EXTM3U\n#EXT-X-BYTERANGE:8@4\na.ts"} {
		f.Add(value)
	}
	f.Fuzz(func(t *testing.T, text string) {
		if len(text) <= 65536 {
			comparePlaylistParsers(t, text)
		}
	})
}

func TestDirectoryScanFilteringParity(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"A.PNG", "a.png", "empty.jpg", "Dockerfile", ".gitignore", "字幕.SRT", "sample.CSV", "ignored.bin", "._cover.png", "archive.ZIP"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(root, "Folder"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "A.PNG"), filepath.Join(root, "link.png")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "Folder"), filepath.Join(root, "linked.png")); err != nil {
		t.Fatal(err)
	}
	application := New()
	defer application.Shutdown()
	for _, filter := range [][]string{nil, {}, {".png"}} {
		got, err := application.Library.ScanDirectory(root, filter, nil, nil, nil, 0)
		want, wantErr := application.Library.referenceScanDirectory(root, filter, nil, nil, 0)
		if fmt.Sprint(err) != fmt.Sprint(wantErr) || !reflect.DeepEqual(got, want) {
			t.Fatalf("scan changed for filter %v", filter)
		}
	}
	id := application.Library.BeginOperation()
	application.Library.CancelOperation(id)
	got, err := application.Library.ScanDirectory(root, nil, nil, nil, nil, id)
	want, wantErr := application.Library.referenceScanDirectory(root, nil, nil, nil, id)
	if fmt.Sprint(err) != fmt.Sprint(wantErr) || !reflect.DeepEqual(got, want) {
		t.Fatal("cancelled scan changed")
	}
}

func TestUpdateProgressRetainsStateWithoutReleaseBody(t *testing.T) {
	u := testUpdateService(t)
	for _, phase := range []string{"checking", "available", "downloading", "verifying", "preparing", "restarting", "error", "cancelled", "current"} {
		for _, release := range []*updater.Release{nil, {Tag: "1.26.1003-build-2200", Notes: strings.Repeat("notes ", 20000)}} {
			u.mu.Lock()
			u.state = UpdateState{Phase: phase, CurrentVersion: "1.26.1003 build 2100", Release: release, Bytes: 17, Error: "network", InstallError: "signature"}
			u.mu.Unlock()
			progress := u.GetUpdateProgress()
			state := u.GetUpdateState()
			if progress.Phase != state.Phase || progress.CurrentVersion != state.CurrentVersion || progress.Bytes != state.Bytes || progress.Error != state.Error || progress.InstallError != state.InstallError {
				t.Fatal("lost progress fields")
			}
			if release == nil && progress.ReleaseTag != "" || release != nil && progress.ReleaseTag != release.Tag {
				t.Fatal("lost release identity")
			}
			payload, err := json.Marshal(progress)
			if err != nil || len(payload) > 256 {
				t.Fatalf("progress unexpectedly includes metadata: %d %v", len(payload), err)
			}
			if state.Release != release {
				t.Fatal("full snapshot changed")
			}
		}
	}
}

func BenchmarkFunctionPlaylist(b *testing.B) {
	for _, count := range []int{64, 10000} {
		var text strings.Builder
		text.WriteString("#EXTM3U\r\n")
		for i := 0; i < count; i++ {
			fmt.Fprintf(&text, "#EXTINF:4.0,\r\nsegment-%06d.ts\r\n", i)
		}
		text.WriteString("#EXT-X-ENDLIST\r\n")
		content := text.String()
		base, _ := url.Parse("https://example.test/media/master.m3u8")
		for _, method := range []struct {
			name  string
			parse func(string, *url.URL) (hlsPlaylist, error)
		}{{"before", referenceParseHLSPlaylist}, {"after", parseHLSPlaylist}} {
			b.Run(fmt.Sprintf("%d/%s", count, method.name), func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					playlist, err := method.parse(content, base)
					if err != nil || len(playlist.Segments) != count {
						b.Fatal("invalid result", err)
					}
				}
			})
		}
	}
}

func BenchmarkFunctionDirectoryScan(b *testing.B) {
	root := filepath.Join(b.TempDir(), strings.Repeat("library-", 12))
	if err := os.Mkdir(root, 0700); err != nil {
		b.Fatal(err)
	}
	for i := 0; i < 2000; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("unused-%04d.bin", i)), nil, 0600); err != nil {
			b.Fatal(err)
		}
	}
	application := New()
	defer application.Shutdown()
	for _, method := range []struct {
		name string
		scan func(string, []string, []string, []string, int64) (DirectoryScanResult, error)
	}{
		{"before", application.Library.referenceScanDirectory}, {"after", func(root string, images, documents, media []string, id int64) (DirectoryScanResult, error) {
			return application.Library.ScanDirectory(root, images, documents, nil, media, id)
		}},
	} {
		b.Run(method.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				result, err := method.scan(root, nil, nil, nil, 0)
				if err != nil || len(result.Node.Images) != 0 {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkFunctionUpdateProgress(b *testing.B) {
	u := newUpdateService()
	defer u.cleanup()
	u.state = UpdateState{Phase: "downloading", CurrentVersion: "1.26.1003 build 2100", Bytes: 1024,
		Release: &updater.Release{Tag: "1.26.1003-build-2200", Version: "1.26.1003 build 2200", Notes: strings.Repeat("Release changes.\n", 8192), Size: 100000}}
	b.Run("before", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			payload, err := json.Marshal(u.GetUpdateState())
			if err != nil {
				b.Fatal(err)
			}
			b.ReportMetric(float64(len(payload)), "payload-B")
		}
	})
	b.Run("after", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			payload, err := json.Marshal(u.GetUpdateProgress())
			if err != nil {
				b.Fatal(err)
			}
			b.ReportMetric(float64(len(payload)), "payload-B")
		}
	})
}
