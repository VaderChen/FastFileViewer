package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVersionOrderingAndLegacyMigration(t *testing.T) {
	for _, pair := range [][2]string{
		{"1.26.1003-build-0000", "v1.26.1003-r2"},
		{"1.26.1003-build-2100", "1.26.1003 build 2059"},
		{"1.26.1004-build-0001", "1.26.1003 build 2359"},
		{"v1.26.1003-r10", "v1.26.1003-r2"},
		{"v1.26.1003-r2", "1.26.1003"},
		{"1.27.0101-build-0000", "1.26.1231 build 2359"},
	} {
		newer, err := Newer(pair[0], pair[1])
		if !newer || err != nil {
			t.Fatalf("%v: newer=%v err=%v", pair, newer, err)
		}
		older, err := Newer(pair[1], pair[0])
		if older || err != nil {
			t.Fatalf("reverse %v: newer=%v err=%v", pair, older, err)
		}
	}
	for _, value := range []string{"development", "1.26.0230-build-0000", "1.26.1003-build-2400", "1.26.1003-build-1260", "1.26.1003-r0", "1.26.1003-beta", "1.26.1003-build-1", "../1.26.1003"} {
		if _, err := Newer(value, "1.26.1003"); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
	if got := CurrentVersion("1.26.1003 build 2200", "v1.26.1003-r2"); got != "1.26.1003 build 2200" {
		t.Fatal(got)
	}
	if got := CurrentVersion("1.26.1003", "v1.26.1003-r2"); got != "v1.26.1003-r2" {
		t.Fatal(got)
	}
	if got, err := Newer("1.26.1003-build-0105", "1.26.1003 build 0105"); got || err != nil {
		t.Fatal("equal versions not equal")
	}
}

func releasePayload(t *testing.T) githubRelease {
	t.Helper()
	var value githubRelease
	data := `{"tag_name":"1.26.1003-build-2200","body":"Update notes","assets":[{"name":"FastFileViewer-1.26.1003-build-2200-arm64.dmg","browser_download_url":"https://github.com/VaderChen/FastFileViewer/releases/download/1.26.1003-build-2200/FastFileViewer-1.26.1003-build-2200-arm64.dmg","size":1024,"digest":"sha256:` + strings.Repeat("a", 64) + `"}]}`
	if err := json.Unmarshal([]byte(data), &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestReleaseSelectionRequiresCompleteOfficialAsset(t *testing.T) {
	valid := releasePayload(t)
	selected, err := selectRelease(valid)
	if err != nil || selected.Version != "1.26.1003 build 2200" {
		t.Fatalf("%+v %v", selected, err)
	}
	for name, mutate := range map[string]func(*githubRelease){
		"draft":            func(r *githubRelease) { r.Draft = true },
		"prerelease":       func(r *githubRelease) { r.Prerelease = true },
		"no asset":         func(r *githubRelease) { r.Assets = nil },
		"wrong arch":       func(r *githubRelease) { r.Assets[0].Name = "FastFileViewer-x64.dmg" },
		"no digest":        func(r *githubRelease) { r.Assets[0].Digest = "" },
		"wrong repository": func(r *githubRelease) { r.Assets[0].URL = strings.Replace(r.Assets[0].URL, "VaderChen", "someone", 1) },
		"wrong tag": func(r *githubRelease) {
			r.Assets[0].URL = strings.Replace(r.Assets[0].URL, "download/1.26.1003-build-2200", "download/v1.26.0824", 1)
		},
		"oversize":        func(r *githubRelease) { r.Assets[0].Size = maxPackageBytes + 1 },
		"unknown version": func(r *githubRelease) { r.Tag = "latest" },
	} {
		t.Run(name, func(t *testing.T) {
			r := releasePayload(t)
			mutate(&r)
			if _, err := selectRelease(r); err == nil {
				t.Fatal("accepted unsafe release")
			}
		})
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDownloadIntegrityLimitsAndCleanup(t *testing.T) {
	data := strings.Repeat("x", 1024)
	digest := sha256.Sum256([]byte(data))
	for _, name := range []string{"valid", "truncated", "oversized", "bad hash", "cancelled"} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			r := Release{Asset: releaseDownloadPrefix + "test/file.dmg", Size: int64(len(data)), SHA256: hex.EncodeToString(digest[:])}
			body := data
			switch name {
			case "truncated":
				body = body[:len(body)-1]
			case "oversized":
				body += "extra"
			case "bad hash":
				r.SHA256 = strings.Repeat("0", 64)
			case "cancelled":
				cancel()
			}
			client := &Client{http: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if req.Context().Err() != nil {
					return nil, req.Context().Err()
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), ContentLength: -1}, nil
			})}}
			destination := filepath.Join(t.TempDir(), "update.dmg")
			lastProgress := int64(0)
			err := client.Download(ctx, r, destination, func(n int64) { lastProgress = n })
			if name == "valid" {
				if err != nil || lastProgress != r.Size {
					t.Fatalf("%v, progress %d", err, lastProgress)
				}
				got, _ := os.ReadFile(destination)
				if string(got) != data {
					t.Fatal("corrupt saved file")
				}
			} else {
				if err == nil {
					t.Fatal("bad download accepted")
				}
				if _, err := os.Stat(destination); !os.IsNotExist(err) {
					t.Fatal("failed download retained")
				}
			}
		})
	}
}

func TestLatestAndNetworkFailures(t *testing.T) {
	for _, status := range []int{200, 403, 429, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "" {
					t.Error("unexpected credentials")
				}
				w.WriteHeader(status)
				_ = json.NewEncoder(w).Encode(releasePayload(t))
			}))
			defer server.Close()
			client := &Client{http: server.Client(), endpoint: server.URL}
			_, err := client.Latest(context.Background())
			if (err == nil) != (status == 200) {
				t.Fatalf("status %d err %v", status, err)
			}
			if (status == 403 || status == 429) && err.Error() != "rate_limited" {
				t.Fatal(err)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := NewClient()
	defer client.Close()
	if _, err := client.Latest(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestRedirectPolicy(t *testing.T) {
	client := NewClient()
	defer client.Close()
	for _, address := range []string{"http://github.com/file", "https://github.com.evil.example/file", "https://127.0.0.1/file", "https://user@github.com/file", "https://github.com:8443/file"} {
		request, _ := http.NewRequest("GET", address, nil)
		if client.http.CheckRedirect(request, nil) == nil {
			t.Fatal("accepted " + address)
		}
	}
	request, _ := http.NewRequest("GET", "https://release-assets.githubusercontent.com/file?signature=opaque", nil)
	if err := client.http.CheckRedirect(request, nil); err != nil {
		t.Fatal(err)
	}
	if client.http.CheckRedirect(request, make([]*http.Request, 5)) == nil {
		t.Fatal("redirect loop allowed")
	}
}

func TestSystemCompatibilityAndRestartArguments(t *testing.T) {
	for _, pair := range [][2]string{{"12.0", "12"}, {"13.1", "12.6.1"}, {"12.6.1", "12.6"}} {
		if !systemVersionAtLeast(pair[0], pair[1]) {
			t.Fatal(pair)
		}
	}
	for _, pair := range [][2]string{{"11.7", "12.0"}, {"12.0", "12.1"}, {"garbage", "12"}, {"12", ""}} {
		if systemVersionAtLeast(pair[0], pair[1]) {
			t.Fatal(pair)
		}
	}
	got := FileArguments([]string{"one.png", receiptFlag, "private/started", "two.png"})
	if strings.Join(got, ",") != "one.png,two.png" {
		t.Fatal(got)
	}
}
