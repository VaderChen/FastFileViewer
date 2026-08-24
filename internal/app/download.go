package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxDownloadBytes int64 = 4 * 1024 * 1024 * 1024
const maxDownloadMetadataBytes int64 = 32 * 1024 * 1024
const maxDownloadHistoryBytes int64 = 8 * 1024 * 1024
const maxHLSSegments = 20_000
const maxEmbeddedHLSCandidates = 16

var absoluteHLSURLPattern = regexp.MustCompile(`(?i)(?:https?:)?//[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?`)
var quotedHLSURLPattern = regexp.MustCompile(`(?i)["']([^"']+\.m3u8(?:\?[^"']*)?)["']`)

var downloadUserConfigDir = os.UserConfigDir
var downloadUserHomeDir = os.UserHomeDir
var downloadLookupIP = func(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

var blockedDownloadNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001:db8::/32"),
}

type hlsSegment struct {
	URL       string
	ByteRange string
}

type hlsVariant struct {
	URL       string
	Bandwidth int64
}

type hlsPlaylist struct {
	Variants []hlsVariant
	Segments []hlsSegment
	Ended    bool
}

type downloadRefererContextKey struct{}

func (a *App) StartDownload(rawURL string) (DownloadItem, error) {
	rawURL = strings.TrimSpace(rawURL)
	validationContext, cancelValidation := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelValidation()
	parsedURL, err := validatePublicDownloadURL(validationContext, rawURL)
	if err != nil {
		return DownloadItem{}, err
	}

	item, downloadContext, err := a.enqueueDownload(parsedURL, downloadNameFromURL(parsedURL))
	if err != nil {
		return DownloadItem{}, err
	}
	go a.runDownloadTask(downloadContext, item, func(client *http.Client, directory string) error {
		return a.downloadToDirectory(downloadContext, client, item.ID, parsedURL.String(), directory)
	})
	return item, nil
}

func (a *App) ResolveDownloadURL(rawURL string) (DownloadResolution, error) {
	validationContext, cancelValidation := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelValidation()
	parsedURL, err := validatePublicDownloadURL(validationContext, strings.TrimSpace(rawURL))
	if err != nil {
		return DownloadResolution{}, err
	}
	client := newSafeDownloadClient()
	defer client.CloseIdleConnections()
	return resolveDownloadPage(validationContext, client, parsedURL)
}

func (a *App) StartResolvedDownload(sourceURL string, hlsURL string, preferredName string) (DownloadItem, error) {
	validationContext, cancelValidation := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelValidation()
	parsedSourceURL, err := validatePublicDownloadURL(validationContext, strings.TrimSpace(sourceURL))
	if err != nil {
		return DownloadItem{}, fmt.Errorf("invalid source page URL: %w", err)
	}
	parsedHLSURL, err := validatePublicDownloadURL(validationContext, strings.TrimSpace(hlsURL))
	if err != nil {
		return DownloadItem{}, fmt.Errorf("invalid HLS URL: %w", err)
	}
	if !strings.EqualFold(filepath.Ext(parsedHLSURL.Path), ".m3u8") {
		return DownloadItem{}, errors.New("resolved stream URL is not an .m3u8 playlist")
	}
	preferredName = strings.TrimSuffix(sanitizeDownloadName(preferredName), filepath.Ext(preferredName))
	if preferredName == "" || preferredName == "download" {
		preferredName = strings.TrimSuffix(downloadNameFromURL(parsedSourceURL), filepath.Ext(downloadNameFromURL(parsedSourceURL)))
	}
	item, downloadContext, err := a.enqueueDownload(parsedSourceURL, preferredName)
	if err != nil {
		return DownloadItem{}, err
	}
	go a.runDownloadTask(downloadContext, item, func(client *http.Client, directory string) error {
		return a.downloadResolvedHLS(downloadContext, client, item.ID, parsedHLSURL.String(), directory, redactedDownloadURL(parsedSourceURL), preferredName)
	})
	return item, nil
}

func (a *App) enqueueDownload(parsedURL *url.URL, name string) (DownloadItem, context.Context, error) {
	id := fmt.Sprintf("%d-%d", time.Now().UnixNano(), a.nextDownloadID.Add(1))
	item := DownloadItem{
		ID:        id,
		URL:       redactedDownloadURL(parsedURL),
		Name:      sanitizeDownloadName(name),
		Status:    "queued",
		CreatedAt: time.Now().UnixMilli(),
	}
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	downloadContext, cancelDownload := context.WithCancel(parent)

	a.downloadMu.Lock()
	a.downloads[id] = &item
	a.downloadOrder = append([]string{id}, a.downloadOrder...)
	a.downloadCancels[id] = cancelDownload
	a.downloadMu.Unlock()
	if err := a.persistDownloads(); err != nil {
		a.downloadMu.Lock()
		delete(a.downloads, id)
		delete(a.downloadCancels, id)
		a.downloadOrder = removeDownloadID(a.downloadOrder, id)
		a.downloadMu.Unlock()
		cancelDownload()
		return DownloadItem{}, nil, fmt.Errorf("save download record: %w", err)
	}
	return item, downloadContext, nil
}

func (a *App) ListDownloads() []DownloadItem {
	a.downloadMu.Lock()
	defer a.downloadMu.Unlock()
	items := make([]DownloadItem, 0, len(a.downloadOrder))
	for _, id := range a.downloadOrder {
		if item := a.downloads[id]; item != nil {
			items = append(items, *item)
		}
	}
	return items
}

func (a *App) CancelDownload(id string) {
	a.downloadMu.Lock()
	cancel := a.downloadCancels[id]
	a.downloadMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *App) RemoveDownload(id string) error {
	a.downloadMu.Lock()
	item := a.downloads[id]
	if item == nil {
		a.downloadMu.Unlock()
		return nil
	}
	if item.Status == "queued" || item.Status == "downloading" {
		a.downloadMu.Unlock()
		return errors.New("cancel the active download before removing it")
	}
	delete(a.downloads, id)
	delete(a.downloadCancels, id)
	a.downloadOrder = removeDownloadID(a.downloadOrder, id)
	a.downloadMu.Unlock()
	return a.persistDownloads()
}

func (a *App) RevealDownload(id string) error {
	a.downloadMu.Lock()
	item := a.downloads[id]
	filePath := ""
	if item != nil {
		filePath = item.Path
	}
	a.downloadMu.Unlock()
	if filePath == "" {
		return errors.New("downloaded file is not available")
	}
	if _, err := os.Stat(filePath); err != nil {
		return fmt.Errorf("downloaded file is not available: %w", err)
	}
	if runtime.GOOS != "darwin" {
		return errors.New("revealing files is only supported on macOS")
	}
	return exec.Command("open", "-R", filePath).Start()
}

func (a *App) OpenDownloadsDirectory() error {
	directory, err := downloadsDirectory()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}
	if runtime.GOOS != "darwin" {
		return errors.New("opening folders is only supported on macOS")
	}
	return exec.Command("open", directory).Start()
}

func CleanupDownloads(a *App) {
	a.downloadMu.Lock()
	cancels := make([]context.CancelFunc, 0, len(a.downloadCancels))
	for _, cancel := range a.downloadCancels {
		cancels = append(cancels, cancel)
	}
	a.downloadMu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (a *App) runDownloadTask(ctx context.Context, item DownloadItem, task func(*http.Client, string) error) {
	a.updateDownload(item.ID, func(current *DownloadItem) {
		current.Status = "downloading"
		current.Error = ""
	})

	directory, err := downloadsDirectory()
	if err == nil {
		err = os.MkdirAll(directory, 0o755)
	}
	if err == nil {
		client := newSafeDownloadClient()
		err = task(client, directory)
		client.CloseIdleConnections()
	}

	a.downloadMu.Lock()
	current := a.downloads[item.ID]
	if current != nil {
		switch {
		case errors.Is(err, context.Canceled):
			current.Status = "cancelled"
			current.Error = ""
		case err != nil:
			current.Status = "failed"
			current.Error = err.Error()
		default:
			current.Status = "completed"
			current.Error = ""
			current.CompletedAt = time.Now().UnixMilli()
		}
	}
	delete(a.downloadCancels, item.ID)
	a.downloadMu.Unlock()
	_ = a.persistDownloads()
}

func resolveDownloadPage(ctx context.Context, client *http.Client, parsedURL *url.URL) (DownloadResolution, error) {
	request, err := newDownloadRequest(ctx, parsedURL.String(), "")
	if err != nil {
		return DownloadResolution{}, err
	}
	response, err := client.Do(request)
	if err != nil {
		return DownloadResolution{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
			return DownloadResolution{}, fmt.Errorf("website blocked direct page access (%s); paste a direct .m3u8 URL instead", response.Status)
		}
		return DownloadResolution{}, fmt.Errorf("server returned %s", response.Status)
	}

	resolvedURL := response.Request.URL
	resolution := DownloadResolution{
		SourceURL: redactedDownloadURL(resolvedURL),
		Name:      strings.TrimSuffix(downloadNameFromURL(resolvedURL), filepath.Ext(downloadNameFromURL(resolvedURL))),
	}
	contentType := normalizedContentType(response.Header.Get("Content-Type"))
	if isHLSResponse(resolvedURL, contentType) {
		resolution.Candidates = []HLSCandidate{{URL: resolvedURL.String(), Name: downloadNameFromURL(resolvedURL)}}
		return resolution, nil
	}
	if contentType != "text/html" {
		return resolution, nil
	}
	if response.ContentLength > maxDownloadMetadataBytes {
		return DownloadResolution{}, fmt.Errorf("web page exceeds the %s size limit", formatDownloadBytes(maxDownloadMetadataBytes))
	}
	body, err := readLimitedResponse(response.Body, maxDownloadMetadataBytes)
	if err != nil {
		return DownloadResolution{}, fmt.Errorf("read web page: %w", err)
	}
	for _, candidateURL := range extractEmbeddedHLSURLs(string(body), resolvedURL) {
		candidate, parseErr := url.Parse(candidateURL)
		if parseErr != nil {
			continue
		}
		resolution.Candidates = append(resolution.Candidates, HLSCandidate{
			URL:  candidateURL,
			Name: downloadNameFromURL(candidate),
		})
	}
	return resolution, nil
}

func (a *App) downloadResolvedHLS(ctx context.Context, client *http.Client, id string, hlsURL string, directory string, referer string, preferredName string) error {
	request, err := newDownloadRequest(ctx, hlsURL, referer)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("HLS server returned %s", response.Status)
	}
	return a.downloadHLS(ctx, client, id, response, directory, referer, preferredName)
}

func (a *App) downloadToDirectory(ctx context.Context, client *http.Client, id string, rawURL string, directory string) error {
	request, err := newDownloadRequest(ctx, rawURL, "")
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("server returned %s", response.Status)
	}

	contentType := normalizedContentType(response.Header.Get("Content-Type"))
	if isHLSResponse(response.Request.URL, contentType) {
		return a.downloadHLS(ctx, client, id, response, directory, "", "")
	}
	limit := maxDownloadBytes
	if contentType == "text/html" || strings.HasPrefix(contentType, "text/") {
		limit = maxDownloadMetadataBytes
	}
	if response.ContentLength > limit {
		return fmt.Errorf("download exceeds the %s size limit", formatDownloadBytes(limit))
	}
	if contentType == "text/html" {
		body, err := readLimitedResponse(response.Body, maxDownloadMetadataBytes)
		if err != nil {
			return fmt.Errorf("read web page: %w", err)
		}
		candidates := extractEmbeddedHLSURLs(string(body), response.Request.URL)
		if len(candidates) > 1 {
			return errors.New("multiple embedded HLS playlists require user selection")
		}
		if len(candidates) == 1 {
			preferredName := strings.TrimSuffix(downloadNameFromURL(response.Request.URL), filepath.Ext(downloadNameFromURL(response.Request.URL)))
			referer := redactedDownloadURL(response.Request.URL)
			if err := a.downloadEmbeddedHLS(ctx, client, id, candidates, directory, referer, preferredName); err != nil {
				return err
			}
			return nil
		}
		return a.saveDownloadBody(ctx, id, directory, response, contentType, bytes.NewReader(body), int64(len(body)))
	}
	return a.saveDownloadBody(ctx, id, directory, response, contentType, response.Body, response.ContentLength)
}

func (a *App) saveDownloadBody(ctx context.Context, id string, directory string, response *http.Response, contentType string, body io.Reader, contentLength int64) error {
	limit := maxDownloadBytes
	if contentType == "text/html" || strings.HasPrefix(contentType, "text/") {
		limit = maxDownloadMetadataBytes
	}
	name := responseDownloadName(response, contentType)
	a.updateDownload(id, func(item *DownloadItem) {
		item.Name = name
		item.ContentType = contentType
		item.TotalBytes = maxInt64(contentLength, 0)
	})

	tempPath, err := a.writeDownloadResponse(ctx, id, directory, body, limit)
	if err != nil {
		return err
	}
	finalPath, err := commitDownloadedFile(tempPath, directory, name)
	if err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	a.updateDownload(id, func(item *DownloadItem) {
		item.Path = finalPath
		item.Name = filepath.Base(finalPath)
	})
	return nil
}

func (a *App) downloadEmbeddedHLS(ctx context.Context, client *http.Client, id string, candidates []string, directory string, referer string, preferredName string) error {
	var lastErr error
	for _, candidate := range candidates {
		request, err := newDownloadRequest(ctx, candidate, referer)
		if err != nil {
			lastErr = err
			continue
		}
		response, err := client.Do(request)
		if err != nil {
			lastErr = err
			continue
		}
		if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			lastErr = fmt.Errorf("embedded HLS server returned %s", response.Status)
			response.Body.Close()
			continue
		}
		err = a.downloadHLS(ctx, client, id, response, directory, referer, preferredName)
		response.Body.Close()
		if err == nil {
			return nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("no usable HLS playlist was found")
	}
	return fmt.Errorf("found embedded HLS URLs but could not download them: %w", lastErr)
}

func (a *App) downloadHLS(ctx context.Context, client *http.Client, id string, initialResponse *http.Response, directory string, referer string, preferredName string) error {
	body, err := readLimitedResponse(initialResponse.Body, maxDownloadMetadataBytes)
	if err != nil {
		return fmt.Errorf("read HLS playlist: %w", err)
	}
	playlistURL := initialResponse.Request.URL
	playlist, err := parseHLSPlaylist(string(body), playlistURL)
	if err != nil {
		return err
	}
	for depth := 0; len(playlist.Variants) > 0; depth++ {
		if depth >= 3 {
			return errors.New("HLS master playlist nesting is too deep")
		}
		sort.SliceStable(playlist.Variants, func(i, j int) bool {
			return playlist.Variants[i].Bandwidth > playlist.Variants[j].Bandwidth
		})
		playlistURL, err = url.Parse(playlist.Variants[0].URL)
		if err != nil {
			return err
		}
		body, err = fetchDownloadMetadata(ctx, client, playlistURL.String(), referer)
		if err != nil {
			return fmt.Errorf("fetch HLS media playlist: %w", err)
		}
		playlist, err = parseHLSPlaylist(string(body), playlistURL)
		if err != nil {
			return err
		}
	}
	if !playlist.Ended {
		return errors.New("live HLS playlists are not supported; only completed VOD playlists can be downloaded")
	}
	if len(playlist.Segments) == 0 {
		return errors.New("HLS playlist contains no media segments")
	}
	if len(playlist.Segments) > maxHLSSegments {
		return fmt.Errorf("HLS playlist exceeds the %d segment limit", maxHLSSegments)
	}

	extension := hlsOutputExtension(playlist.Segments)
	baseName := preferredName
	if baseName == "" {
		baseName = strings.TrimSuffix(downloadNameFromURL(initialResponse.Request.URL), filepath.Ext(downloadNameFromURL(initialResponse.Request.URL)))
	}
	name := sanitizeDownloadName(baseName + extension)
	contentType := "video/mp2t"
	if extension == ".mp4" {
		contentType = "video/mp4"
	}
	a.updateDownload(id, func(item *DownloadItem) {
		item.Name = name
		item.ContentType = contentType
		item.TotalBytes = 0
	})

	tempFile, err := os.CreateTemp(directory, ".fastfileviewer-hls-*.part")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()
	completed := false
	defer func() {
		_ = tempFile.Close()
		if !completed {
			_ = os.Remove(tempPath)
		}
	}()

	var total int64
	for _, segment := range playlist.Segments {
		if err := ctx.Err(); err != nil {
			return err
		}
		request, err := newDownloadRequest(ctx, segment.URL, referer)
		if err != nil {
			return err
		}
		if segment.ByteRange != "" {
			request.Header.Set("Range", segment.ByteRange)
		}
		response, err := client.Do(request)
		if err != nil {
			return err
		}
		if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			response.Body.Close()
			return fmt.Errorf("HLS segment returned %s", response.Status)
		}
		if segment.ByteRange != "" && response.StatusCode != http.StatusPartialContent {
			response.Body.Close()
			return errors.New("HLS server ignored a required byte range")
		}
		written, copyErr := copyDownloadBody(ctx, tempFile, response.Body, maxDownloadBytes-total, func(delta int64) {
			total += delta
			a.setDownloadBytes(id, total)
		})
		response.Body.Close()
		if copyErr != nil {
			return copyErr
		}
		if written == 0 {
			return errors.New("HLS segment is empty")
		}
	}
	if err := tempFile.Sync(); err != nil {
		return err
	}
	if err := tempFile.Chmod(0o644); err != nil {
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}
	finalPath, err := commitDownloadedFile(tempPath, directory, name)
	if err != nil {
		return err
	}
	completed = true
	a.updateDownload(id, func(item *DownloadItem) {
		item.Path = finalPath
		item.Name = filepath.Base(finalPath)
		item.TotalBytes = total
		item.Bytes = total
	})
	return nil
}

func (a *App) writeDownloadResponse(ctx context.Context, id string, directory string, source io.Reader, limit int64) (string, error) {
	tempFile, err := os.CreateTemp(directory, ".fastfileviewer-download-*.part")
	if err != nil {
		return "", err
	}
	tempPath := tempFile.Name()
	completed := false
	defer func() {
		_ = tempFile.Close()
		if !completed {
			_ = os.Remove(tempPath)
		}
	}()
	var total int64
	_, err = copyDownloadBody(ctx, tempFile, source, limit, func(delta int64) {
		total += delta
		a.setDownloadBytes(id, total)
	})
	if err != nil {
		return "", err
	}
	if err := tempFile.Sync(); err != nil {
		return "", err
	}
	if err := tempFile.Chmod(0o644); err != nil {
		return "", err
	}
	if err := tempFile.Close(); err != nil {
		return "", err
	}
	completed = true
	return tempPath, nil
}

func copyDownloadBody(ctx context.Context, destination io.Writer, source io.Reader, limit int64, progress func(int64)) (int64, error) {
	if limit <= 0 {
		return 0, fmt.Errorf("download exceeds the %s size limit", formatDownloadBytes(maxDownloadBytes))
	}
	buffer := make([]byte, 256*1024)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		read, readErr := source.Read(buffer)
		if read > 0 {
			if total+int64(read) > limit {
				return total, fmt.Errorf("download exceeds the %s size limit", formatDownloadBytes(limit))
			}
			written, writeErr := destination.Write(buffer[:read])
			if written > 0 {
				total += int64(written)
				progress(int64(written))
			}
			if writeErr != nil {
				return total, writeErr
			}
			if written != read {
				return total, io.ErrShortWrite
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return total, nil
			}
			return total, readErr
		}
	}
}

func (a *App) updateDownload(id string, update func(*DownloadItem)) {
	a.downloadMu.Lock()
	if item := a.downloads[id]; item != nil {
		update(item)
	}
	a.downloadMu.Unlock()
}

func (a *App) setDownloadBytes(id string, bytes int64) {
	a.updateDownload(id, func(item *DownloadItem) {
		item.Bytes = bytes
	})
}

func validatePublicDownloadURL(ctx context.Context, rawURL string) (*url.URL, error) {
	if rawURL == "" {
		return nil, errors.New("enter an HTTP or HTTPS URL")
	}
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return nil, errors.New("only HTTP and HTTPS URLs are supported")
	}
	if parsedURL.User != nil {
		return nil, errors.New("URLs containing credentials are not supported")
	}
	if parsedURL.Hostname() == "" {
		return nil, errors.New("URL does not contain a host")
	}
	if parsedURL.Port() != "" {
		port, err := strconv.Atoi(parsedURL.Port())
		if err != nil || port < 1 || port > 65535 {
			return nil, errors.New("URL contains an invalid port")
		}
	}
	if _, err := lookupPublicDownloadAddresses(ctx, parsedURL.Hostname()); err != nil {
		return nil, err
	}
	return parsedURL, nil
}

func lookupPublicDownloadAddresses(ctx context.Context, host string) ([]net.IPAddr, error) {
	normalizedHost := strings.TrimSuffix(strings.ToLower(host), ".")
	if normalizedHost == "localhost" || strings.HasSuffix(normalizedHost, ".localhost") || strings.HasSuffix(normalizedHost, ".local") {
		return nil, errors.New("local and private network addresses are not allowed")
	}
	if address, err := netip.ParseAddr(normalizedHost); err == nil {
		if !isPublicDownloadAddress(address) {
			return nil, errors.New("local and private network addresses are not allowed")
		}
		return []net.IPAddr{{IP: net.IP(address.AsSlice())}}, nil
	}
	addresses, err := downloadLookupIP(ctx, normalizedHost)
	if err != nil {
		return nil, fmt.Errorf("resolve URL host: %w", err)
	}
	if len(addresses) == 0 {
		return nil, errors.New("URL host did not resolve to an address")
	}
	for _, address := range addresses {
		parsedAddress, ok := netip.AddrFromSlice(address.IP)
		if !ok || !isPublicDownloadAddress(parsedAddress.Unmap()) {
			return nil, errors.New("local and private network addresses are not allowed")
		}
	}
	return addresses, nil
}

func isPublicDownloadAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsValid() || !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() || address.IsMulticast() || address.IsUnspecified() {
		return false
	}
	for _, network := range blockedDownloadNetworks {
		if network.Contains(address) {
			return false
		}
	}
	return true
}

func newSafeDownloadClient() *http.Client {
	dialer := &net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy:                 nil,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          8,
		IdleConnTimeout:       60 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		DialContext: func(ctx context.Context, network string, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			addresses, err := lookupPublicDownloadAddresses(ctx, host)
			if err != nil {
				return nil, err
			}
			var lastErr error
			for _, resolved := range addresses {
				connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(resolved.IP.String(), port))
				if dialErr == nil {
					return connection, nil
				}
				lastErr = dialErr
			}
			return nil, lastErr
		},
	}
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many redirects")
			}
			referer, _ := request.Context().Value(downloadRefererContextKey{}).(string)
			if referer = sanitizeDownloadReferer(referer); referer == "" {
				referer = sanitizeDownloadReferer(request.Header.Get("Referer"))
			}
			if referer != "" {
				request.Header.Set("Referer", referer)
				request.Header.Set("Origin", downloadOrigin(referer))
			} else {
				request.Header.Del("Referer")
				request.Header.Del("Origin")
			}
			request.Header.Del("Cookie")
			request.Header.Del("Authorization")
			validationContext, cancel := context.WithTimeout(request.Context(), 15*time.Second)
			defer cancel()
			_, err := validatePublicDownloadURL(validationContext, request.URL.String())
			return err
		},
	}
}

func newDownloadRequest(ctx context.Context, rawURL string, referer string) (*http.Request, error) {
	referer = sanitizeDownloadReferer(referer)
	if referer != "" {
		ctx = context.WithValue(ctx, downloadRefererContextKey{}, referer)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "FastFileViewer/1 (+https://github.com/VaderChen/FastFileViewer)")
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Accept-Encoding", "identity")
	if referer != "" {
		request.Header.Set("Referer", referer)
		request.Header.Set("Origin", downloadOrigin(referer))
	}
	return request, nil
}

func sanitizeDownloadReferer(rawURL string) string {
	parsedURL, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Hostname() == "" || parsedURL.User != nil {
		return ""
	}
	parsedURL.RawQuery = ""
	parsedURL.ForceQuery = false
	parsedURL.Fragment = ""
	return parsedURL.String()
}

func downloadOrigin(referer string) string {
	parsedURL, err := url.Parse(referer)
	if err != nil || parsedURL.Host == "" {
		return ""
	}
	return parsedURL.Scheme + "://" + parsedURL.Host
}

func redactedDownloadURL(resourceURL *url.URL) string {
	redacted := *resourceURL
	redacted.RawQuery = ""
	redacted.ForceQuery = false
	redacted.Fragment = ""
	return redacted.String()
}

func extractEmbeddedHLSURLs(content string, baseURL *url.URL) []string {
	normalized := html.UnescapeString(content)
	normalized = strings.NewReplacer(
		`\/`, `/`,
		`\u002F`, `/`,
		`\u002f`, `/`,
		`\u003A`, `:`,
		`\u003a`, `:`,
		`\x2F`, `/`,
		`\x2f`, `/`,
		`\x3A`, `:`,
		`\x3a`, `:`,
	).Replace(normalized)

	rawCandidates := absoluteHLSURLPattern.FindAllString(normalized, maxEmbeddedHLSCandidates)
	for _, match := range quotedHLSURLPattern.FindAllStringSubmatch(normalized, maxEmbeddedHLSCandidates) {
		if len(match) > 1 {
			rawCandidates = append(rawCandidates, match[1])
		}
	}

	result := make([]string, 0, minInt(len(rawCandidates), maxEmbeddedHLSCandidates))
	seen := make(map[string]struct{}, len(rawCandidates))
	for _, candidate := range rawCandidates {
		candidate = strings.TrimSpace(strings.Trim(candidate, `"'`))
		if strings.HasPrefix(candidate, "//") {
			candidate = baseURL.Scheme + ":" + candidate
		}
		parsedCandidate, err := url.Parse(candidate)
		if err != nil {
			continue
		}
		resolved := baseURL.ResolveReference(parsedCandidate)
		if (resolved.Scheme != "http" && resolved.Scheme != "https") || resolved.Hostname() == "" || resolved.User != nil || !strings.EqualFold(filepath.Ext(resolved.Path), ".m3u8") {
			continue
		}
		value := resolved.String()
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
		if len(result) >= maxEmbeddedHLSCandidates {
			break
		}
	}
	return result
}

func parseHLSPlaylist(content string, baseURL *url.URL) (hlsPlaylist, error) {
	if !strings.HasPrefix(strings.TrimSpace(content), "#EXTM3U") {
		return hlsPlaylist{}, errors.New("invalid HLS playlist")
	}
	playlist := hlsPlaylist{}
	scanner := bufio.NewScanner(strings.NewReader(content))
	scanner.Buffer(make([]byte, 64*1024), int(maxDownloadMetadataBytes))
	variantPending := false
	var variantBandwidth int64
	var pendingRange string
	var rangeOffset int64
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		switch {
		case strings.HasPrefix(line, "#EXT-X-KEY:"):
			attributes := parseHLSAttributes(strings.TrimPrefix(line, "#EXT-X-KEY:"))
			if method := strings.ToUpper(attributes["METHOD"]); method != "" && method != "NONE" {
				return hlsPlaylist{}, errors.New("encrypted or protected HLS streams are not supported")
			}
		case strings.HasPrefix(line, "#EXT-X-STREAM-INF:"):
			attributes := parseHLSAttributes(strings.TrimPrefix(line, "#EXT-X-STREAM-INF:"))
			variantBandwidth, _ = strconv.ParseInt(attributes["BANDWIDTH"], 10, 64)
			variantPending = true
		case strings.HasPrefix(line, "#EXT-X-MAP:"):
			attributes := parseHLSAttributes(strings.TrimPrefix(line, "#EXT-X-MAP:"))
			resolved, err := resolveHLSReference(baseURL, attributes["URI"])
			if err != nil {
				return hlsPlaylist{}, err
			}
			byteRange, _, err := hlsByteRange(attributes["BYTERANGE"], 0)
			if err != nil {
				return hlsPlaylist{}, err
			}
			playlist.Segments = append(playlist.Segments, hlsSegment{URL: resolved, ByteRange: byteRange})
		case strings.HasPrefix(line, "#EXT-X-BYTERANGE:"):
			pendingRange = strings.TrimSpace(strings.TrimPrefix(line, "#EXT-X-BYTERANGE:"))
		case line == "#EXT-X-ENDLIST":
			playlist.Ended = true
		case strings.HasPrefix(line, "#"):
			continue
		default:
			resolved, err := resolveHLSReference(baseURL, line)
			if err != nil {
				return hlsPlaylist{}, err
			}
			if variantPending {
				playlist.Variants = append(playlist.Variants, hlsVariant{URL: resolved, Bandwidth: variantBandwidth})
				variantPending = false
				continue
			}
			byteRange, nextOffset, err := hlsByteRange(pendingRange, rangeOffset)
			if err != nil {
				return hlsPlaylist{}, err
			}
			if pendingRange != "" {
				rangeOffset = nextOffset
			} else {
				rangeOffset = 0
			}
			playlist.Segments = append(playlist.Segments, hlsSegment{URL: resolved, ByteRange: byteRange})
			pendingRange = ""
		}
	}
	if err := scanner.Err(); err != nil {
		return hlsPlaylist{}, err
	}
	return playlist, nil
}

func parseHLSAttributes(value string) map[string]string {
	attributes := make(map[string]string)
	start := 0
	quoted := false
	parts := make([]string, 0, 8)
	for index, character := range value {
		if character == '"' {
			quoted = !quoted
		}
		if character == ',' && !quoted {
			parts = append(parts, value[start:index])
			start = index + 1
		}
	}
	parts = append(parts, value[start:])
	for _, part := range parts {
		key, attributeValue, found := strings.Cut(part, "=")
		if !found {
			continue
		}
		attributes[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(attributeValue), "\"")
	}
	return attributes
}

func hlsByteRange(value string, fallbackOffset int64) (string, int64, error) {
	if value == "" {
		return "", fallbackOffset, nil
	}
	lengthText, offsetText, hasOffset := strings.Cut(strings.TrimSpace(value), "@")
	length, err := strconv.ParseInt(lengthText, 10, 64)
	if err != nil || length <= 0 {
		return "", 0, errors.New("invalid HLS byte range")
	}
	offset := fallbackOffset
	if hasOffset {
		offset, err = strconv.ParseInt(offsetText, 10, 64)
		if err != nil || offset < 0 {
			return "", 0, errors.New("invalid HLS byte range offset")
		}
	}
	return fmt.Sprintf("bytes=%d-%d", offset, offset+length-1), offset + length, nil
}

func resolveHLSReference(baseURL *url.URL, reference string) (string, error) {
	if reference == "" {
		return "", errors.New("HLS playlist contains an empty URL")
	}
	parsedReference, err := url.Parse(reference)
	if err != nil {
		return "", err
	}
	resolved := baseURL.ResolveReference(parsedReference)
	if (resolved.Scheme != "http" && resolved.Scheme != "https") || resolved.Hostname() == "" || resolved.User != nil {
		return "", errors.New("HLS playlist contains an unsupported URL")
	}
	return resolved.String(), nil
}

func fetchDownloadMetadata(ctx context.Context, client *http.Client, rawURL string, referer string) ([]byte, error) {
	request, err := newDownloadRequest(ctx, rawURL, referer)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("server returned %s", response.Status)
	}
	return readLimitedResponse(response.Body, maxDownloadMetadataBytes)
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func readLimitedResponse(reader io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("response exceeds the %s size limit", formatDownloadBytes(limit))
	}
	return data, nil
}

func isHLSResponse(resourceURL *url.URL, contentType string) bool {
	extension := strings.ToLower(filepath.Ext(resourceURL.Path))
	return extension == ".m3u8" || contentType == "application/vnd.apple.mpegurl" || contentType == "application/x-mpegurl" || contentType == "audio/mpegurl" || contentType == "audio/x-mpegurl"
}

func hlsOutputExtension(segments []hlsSegment) string {
	for _, segment := range segments {
		parsedURL, err := url.Parse(segment.URL)
		if err != nil {
			continue
		}
		switch strings.ToLower(filepath.Ext(parsedURL.Path)) {
		case ".m4s", ".mp4", ".m4v", ".cmfv", ".cmfa":
			return ".mp4"
		case ".aac":
			return ".aac"
		case ".mp3":
			return ".mp3"
		case ".ts":
			return ".m2ts"
		}
	}
	return ".ts"
}

func normalizedContentType(header string) string {
	mediaType, _, err := mime.ParseMediaType(header)
	if err != nil {
		return strings.ToLower(strings.TrimSpace(strings.Split(header, ";")[0]))
	}
	return strings.ToLower(mediaType)
}

func responseDownloadName(response *http.Response, contentType string) string {
	if disposition := response.Header.Get("Content-Disposition"); disposition != "" {
		if _, parameters, err := mime.ParseMediaType(disposition); err == nil {
			if filename := parameters["filename"]; filename != "" {
				return ensureDownloadExtension(sanitizeDownloadName(filename), contentType)
			}
		}
	}
	return ensureDownloadExtension(downloadNameFromURL(response.Request.URL), contentType)
}

func downloadNameFromURL(resourceURL *url.URL) string {
	name, err := url.PathUnescape(filepath.Base(resourceURL.Path))
	if err != nil || name == "" || name == "." || name == "/" {
		name = "download"
	}
	return sanitizeDownloadName(name)
}

func sanitizeDownloadName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	name = strings.Map(func(character rune) rune {
		if character < 32 || character == 127 || character == '/' || character == '\\' || character == ':' {
			return '_'
		}
		return character
	}, name)
	name = strings.Trim(name, ". ")
	if name == "" {
		name = "download"
	}
	if len([]rune(name)) > 180 {
		extension := filepath.Ext(name)
		base := []rune(strings.TrimSuffix(name, extension))
		maximumBase := 180 - len([]rune(extension))
		if maximumBase < 1 {
			maximumBase = 1
		}
		if len(base) > maximumBase {
			base = base[:maximumBase]
		}
		name = string(base) + extension
	}
	return name
}

func ensureDownloadExtension(name string, contentType string) string {
	if filepath.Ext(name) != "" {
		return name
	}
	switch contentType {
	case "text/html":
		return name + ".html"
	case "application/json":
		return name + ".json"
	case "text/plain":
		return name + ".txt"
	}
	extensions, _ := mime.ExtensionsByType(contentType)
	if len(extensions) > 0 {
		return name + extensions[0]
	}
	return name
}

func commitDownloadedFile(tempPath string, directory string, name string) (string, error) {
	name = sanitizeDownloadName(name)
	extension := filepath.Ext(name)
	base := strings.TrimSuffix(name, extension)
	for index := 0; index < 10_000; index++ {
		candidateName := name
		if index > 0 {
			candidateName = fmt.Sprintf("%s (%d)%s", base, index, extension)
		}
		candidatePath := filepath.Join(directory, candidateName)
		if err := os.Link(tempPath, candidatePath); err == nil {
			if err := os.Remove(tempPath); err != nil {
				_ = os.Remove(candidatePath)
				return "", err
			}
			return candidatePath, nil
		} else if !errors.Is(err, os.ErrExist) {
			return "", err
		}
	}
	return "", errors.New("unable to allocate a unique download filename")
}

func downloadsDirectory() (string, error) {
	home, err := downloadUserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, "Downloads", "FastFileViewer"), nil
}

func downloadsHistoryPath() (string, error) {
	configDirectory, err := downloadUserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDirectory, "FastFileViewer", "downloads.json"), nil
}

func (a *App) persistDownloads() error {
	a.downloadPersist.Lock()
	defer a.downloadPersist.Unlock()
	items := a.ListDownloads()
	payload, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return err
	}
	historyPath, err := downloadsHistoryPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(historyPath), 0o700); err != nil {
		return err
	}
	tempFile, err := os.CreateTemp(filepath.Dir(historyPath), ".downloads-*.tmp")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()
	defer os.Remove(tempPath)
	if err := tempFile.Chmod(0o600); err != nil {
		tempFile.Close()
		return err
	}
	if _, err := tempFile.Write(payload); err != nil {
		tempFile.Close()
		return err
	}
	if err := tempFile.Sync(); err != nil {
		tempFile.Close()
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, historyPath)
}

func (a *App) loadDownloads() {
	historyPath, err := downloadsHistoryPath()
	if err != nil {
		return
	}
	info, err := os.Stat(historyPath)
	if err != nil || info.Size() > maxDownloadHistoryBytes {
		return
	}
	payload, err := os.ReadFile(historyPath)
	if err != nil {
		return
	}
	var items []DownloadItem
	if err := json.Unmarshal(payload, &items); err != nil {
		return
	}
	a.downloadMu.Lock()
	defer a.downloadMu.Unlock()
	a.downloads = make(map[string]*DownloadItem, len(items))
	a.downloadOrder = make([]string, 0, len(items))
	for index := range items {
		item := items[index]
		if item.ID == "" || item.URL == "" {
			continue
		}
		if item.Status == "queued" || item.Status == "downloading" {
			item.Status = "failed"
			item.Error = "download was interrupted when the app closed"
		}
		copyItem := item
		a.downloads[item.ID] = &copyItem
		a.downloadOrder = append(a.downloadOrder, item.ID)
	}
}

func removeDownloadID(ids []string, target string) []string {
	filtered := ids[:0]
	for _, id := range ids {
		if id != target {
			filtered = append(filtered, id)
		}
	}
	return filtered
}

func maxInt64(value int64, minimum int64) int64 {
	if value < minimum {
		return minimum
	}
	return value
}

func formatDownloadBytes(bytes int64) string {
	if bytes%(1024*1024*1024) == 0 && bytes >= 1024*1024*1024 {
		return fmt.Sprintf("%d GB", bytes/(1024*1024*1024))
	}
	return fmt.Sprintf("%d MB", bytes/(1024*1024))
}
