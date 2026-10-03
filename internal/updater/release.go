// Package updater checks published releases and installs verified macOS updates.
package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const latestReleaseURL = "https://api.github.com/repos/VaderChen/FastFileViewer/releases/latest"
const releaseDownloadPrefix = "https://github.com/VaderChen/FastFileViewer/releases/download/"
const maxPackageBytes int64 = 1024 * 1024 * 1024

var versionPattern = regexp.MustCompile(`^v?(\d+)\.(\d{2})\.(\d{4})(?:(?:-build-| build )(\d{4})|-r([1-9]\d*))?$`)

type version struct{ major, year, day, scheme, build int }

func parseVersion(value string) (version, bool) {
	m := versionPattern.FindStringSubmatch(value)
	if m == nil {
		return version{}, false
	}
	var parts [5]int
	for i, text := range m[1:] {
		if text != "" {
			number, err := strconv.Atoi(text)
			if err != nil {
				return version{}, false
			}
			parts[i] = number
		}
	}
	if _, err := time.Parse("20060102", "20"+m[2]+m[3]); err != nil || parts[0] < 1 {
		return version{}, false
	}
	v := version{major: parts[0], year: parts[1], day: parts[2], build: parts[4]}
	if m[4] != "" {
		if parts[3]/100 > 23 || parts[3]%100 > 59 {
			return version{}, false
		}
		v.scheme, v.build = 1, parts[3]
	}
	return v, true
}

// A build timestamp wins over a possibly older source tag in local builds.
// Legacy releases used a date-only display version and a revision in the tag.
func CurrentVersion(display, tag string) string {
	if v, ok := parseVersion(display); ok && v.scheme == 1 {
		return display
	}
	if _, ok := parseVersion(tag); ok {
		return tag
	}
	return display
}

func Newer(candidate, current string) (bool, error) {
	a, validA := parseVersion(candidate)
	b, validB := parseVersion(current)
	if !validA || !validB {
		return false, errors.New("version")
	}
	left := [...]int{a.major, a.year, a.day, a.scheme, a.build}
	right := [...]int{b.major, b.year, b.day, b.scheme, b.build}
	for i := range left {
		if left[i] != right[i] {
			return left[i] > right[i], nil
		}
	}
	return false, nil
}

type Release struct {
	Tag     string `json:"tag"`
	Version string `json:"version"`
	Notes   string `json:"notes"`
	URL     string `json:"url"`
	Size    int64  `json:"size"`
	SHA256  string `json:"-"`
	Asset   string `json:"-"`
}

type githubRelease struct {
	Tag        string `json:"tag_name"`
	Body       string `json:"body"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name   string `json:"name"`
		URL    string `json:"browser_download_url"`
		Size   int64  `json:"size"`
		Digest string `json:"digest"`
	} `json:"assets"`
}

type Client struct {
	http     *http.Client
	endpoint string
}

func trustedDownloadURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	switch u.Host {
	case "github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com":
		return true
	}
	return false
}

func NewClient() *Client {
	return &Client{endpoint: latestReleaseURL, http: &http.Client{
		Timeout: 30 * time.Minute,
		Transport: &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			DialContext:         (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 20 * time.Second,
			IdleConnTimeout: 30 * time.Second, MaxIdleConnsPerHost: 2,
		},
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 5 || !trustedDownloadURL(request.URL.String()) {
				return errors.New("untrusted update redirect")
			}
			return nil
		},
	}}
}

func (c *Client) Close() { c.http.CloseIdleConnections() }

func (c *Client) get(ctx context.Context, address string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "FastFileViewer-Updater")
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		if response.StatusCode == 403 || response.StatusCode == 429 {
			return nil, errors.New("rate_limited")
		}
		return nil, fmt.Errorf("update server returned HTTP %d", response.StatusCode)
	}
	return response, nil
}

func (c *Client) Latest(ctx context.Context) (Release, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	response, err := c.get(ctx, c.endpoint)
	if err != nil {
		return Release{}, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil || len(body) > 2<<20 {
		return Release{}, errors.New("invalid_release")
	}
	var payload githubRelease
	if json.Unmarshal(body, &payload) != nil {
		return Release{}, errors.New("invalid_release")
	}
	return selectRelease(payload)
}

func selectRelease(payload githubRelease) (Release, error) {
	if _, ok := parseVersion(payload.Tag); !ok || payload.Draft || payload.Prerelease {
		return Release{}, errors.New("invalid_release")
	}
	name := "FastFileViewer-" + strings.TrimPrefix(payload.Tag, "v") + "-arm64.dmg"
	for _, asset := range payload.Assets {
		if asset.Name != name {
			continue
		}
		digest := strings.TrimPrefix(asset.Digest, "sha256:")
		decoded, err := hex.DecodeString(digest)
		expectedURL := releaseDownloadPrefix + payload.Tag + "/" + name
		if err != nil || len(decoded) != sha256.Size || !strings.HasPrefix(asset.Digest, "sha256:") ||
			asset.URL != expectedURL || asset.Size <= 0 || asset.Size > maxPackageBytes {
			return Release{}, errors.New("invalid_release")
		}
		return Release{Tag: payload.Tag, Version: strings.Replace(strings.TrimPrefix(payload.Tag, "v"), "-build-", " build ", 1),
			Notes: payload.Body, URL: "https://github.com/VaderChen/FastFileViewer/releases/tag/" + payload.Tag,
			Size: asset.Size, SHA256: strings.ToLower(digest), Asset: asset.URL}, nil
	}
	return Release{}, errors.New("missing_asset")
}

// Download streams to a private file and reports actual bytes, never buffering a DMG in memory.
func (c *Client) Download(ctx context.Context, release Release, destination string, progress func(int64)) (err error) {
	if !trustedDownloadURL(release.Asset) || release.Size <= 0 || release.Size > maxPackageBytes {
		return errors.New("invalid_release")
	}
	response, err := c.get(ctx, release.Asset)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.ContentLength >= 0 && response.ContentLength != release.Size {
		return errors.New("checksum")
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer func() {
		file.Close()
		if err != nil {
			os.Remove(destination)
		}
	}()
	hash := sha256.New()
	writer := &progressWriter{writer: io.MultiWriter(file, hash), notify: progress}
	_, err = io.CopyBuffer(writer, io.LimitReader(response.Body, release.Size+1), make([]byte, 256*1024))
	if err != nil {
		return err
	}
	if writer.bytes != release.Size || hex.EncodeToString(hash.Sum(nil)) != release.SHA256 {
		return errors.New("checksum")
	}
	if err = file.Sync(); err != nil {
		return err
	}
	return file.Close()
}

type progressWriter struct {
	writer io.Writer
	notify func(int64)
	bytes  int64
}

func (w *progressWriter) Write(data []byte) (int, error) {
	n, err := w.writer.Write(data)
	w.bytes += int64(n)
	if w.notify != nil {
		w.notify(w.bytes)
	}
	return n, err
}
