package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func isolateDownloadStorage(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	previousConfig, previousHome := downloadUserConfigDir, downloadUserHomeDir
	downloadUserConfigDir = func() (string, error) { return directory, nil }
	downloadUserHomeDir = func() (string, error) { return directory, nil }
	t.Cleanup(func() {
		downloadUserConfigDir, downloadUserHomeDir = previousConfig, previousHome
	})
	return directory
}

func TestDownloadShutdownRejectsNewQueueEntries(t *testing.T) {
	isolateDownloadStorage(t)
	application := newDownloadService()
	application.Startup(context.Background())
	application.cleanup()
	_, ctx, err := application.enqueueDownload(mustParseDownloadURL(t, "https://example.com/movie.mp4"), "movie.mp4")
	if err == nil {
		if ctx != nil {
			application.cleanup()
		}
		t.Fatal("closed service accepted a new download")
	}
	if got := application.ListDownloads(); len(got) != 0 {
		t.Fatalf("closed service added a history entry: %#v", got)
	}
}

func TestDownloadShutdownCancelsPendingURLValidation(t *testing.T) {
	for _, shutdown := range []string{"cleanup", "parent-context"} {
		for _, action := range []string{"download", "resolve", "resolved-download"} {
			t.Run(shutdown+"/"+action, func(t *testing.T) {
				isolateDownloadStorage(t)
				application := newDownloadService()
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				application.Startup(ctx)
				defer application.cleanup()
				entered := make(chan struct{})
				release := make(chan struct{})
				previousLookup := downloadLookupIP
				downloadLookupIP = func(ctx context.Context, _ string) ([]net.IPAddr, error) {
					close(entered)
					select {
					case <-ctx.Done():
						return nil, ctx.Err()
					case <-release:
						return nil, errors.New("test released blocked resolver")
					}
				}
				t.Cleanup(func() { downloadLookupIP = previousLookup })
				done := make(chan error, 1)
				go func() {
					var err error
					switch action {
					case "download":
						_, err = application.StartDownload("https://download.example/movie.mp4")
					case "resolve":
						_, err = application.ResolveDownloadURL("https://download.example/watch")
					default:
						_, err = application.StartResolvedDownload("https://download.example/watch", "https://download.example/index.m3u8", "movie")
					}
					done <- err
				}()
				<-entered
				if shutdown == "cleanup" {
					application.cleanup()
				} else {
					cancel()
				}
				select {
				case err := <-done:
					if !errors.Is(err, context.Canceled) {
						t.Fatalf("shutdown returned %v instead of cancellation", err)
					}
				case <-time.After(time.Second):
					close(release)
					<-done
					t.Fatal("URL validation survived service shutdown")
				}
			})
		}
	}
}

func TestCancelledDownloadTaskDoesNotStartIO(t *testing.T) {
	directory := isolateDownloadStorage(t)
	application := newDownloadTestApp("cancel-before-start")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	application.runDownloadTask(ctx, application.ListDownloads()[0], func(*http.Client, string) error {
		called = true
		return nil
	})
	if called {
		t.Error("a cancelled queued task started its transfer")
	}
	if item := application.ListDownloads()[0]; item.Status != "cancelled" {
		t.Errorf("cancelled queued task was recorded as %s", item.Status)
	}
	if _, err := os.Stat(filepath.Join(directory, "Downloads")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("cancelled queued task created its output directory: %v", err)
	}
}

func TestDownloadHistoryRejectsSpecialFileWithoutBlocking(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("FIFO fixture requires Unix")
	}
	isolateDownloadStorage(t)
	historyPath, err := downloadsHistoryPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(historyPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("mkfifo", historyPath).CombinedOutput(); err != nil {
		t.Fatalf("mkfifo: %v: %s", err, output)
	}
	application := newDownloadService()
	done := make(chan struct{})
	go func() {
		application.Startup(context.Background())
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		// Unblock the previous implementation so the regression leaves no goroutine.
		writer, err := os.OpenFile(historyPath, os.O_RDWR, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		_ = writer.Close()
		<-done
		t.Fatal("download startup blocked on a special history file")
	}
	application.cleanup()
}

func TestDownloadNetworkErrorRedactsSignedURLFromHistory(t *testing.T) {
	isolateDownloadStorage(t)
	application := newDownloadTestApp("signed-url")
	application.runDownloadTask(context.Background(), application.ListDownloads()[0], func(*http.Client, string) error {
		return fmt.Errorf("fetch HLS media playlist: %w", &url.Error{
			Op: "Get", URL: "https://cdn.example/movie.m3u8?token=secret-token#private-fragment", Err: errors.New("connection reset"),
		})
	})
	historyPath, err := downloadsHistoryPath()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(historyPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), "secret-token") || strings.Contains(string(payload), "private-fragment") {
		t.Fatalf("network failure persisted URL credentials: %s", payload)
	}
	if item := application.ListDownloads()[0]; !strings.Contains(item.Error, "connection reset") || !strings.Contains(item.Error, "https://cdn.example/movie.m3u8") {
		t.Fatalf("redaction removed the useful failure detail: %#v", item)
	}
}

func TestDownloadFinderLaunchReportsProcessFailure(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Finder integration requires macOS")
	}
	directory := isolateDownloadStorage(t)
	binDirectory := filepath.Join(directory, "bin")
	if err := os.Mkdir(binDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDirectory, "open"), []byte("#!/bin/sh\nexit 7\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDirectory)
	application := newDownloadTestApp("reveal")
	filePath := filepath.Join(directory, "completed.txt")
	if err := os.WriteFile(filePath, []byte("complete"), 0o600); err != nil {
		t.Fatal(err)
	}
	application.downloads["reveal"].Path = filePath
	for _, action := range []func() error{func() error { return application.RevealDownload("reveal") }, application.OpenDownloadsDirectory} {
		var processError *exec.ExitError
		if err := action(); !errors.As(err, &processError) || processError.ExitCode() != 7 {
			t.Fatalf("open command failure was not observed: %v", err)
		}
	}
}
