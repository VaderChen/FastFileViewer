package app

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestImageHTTPInvalidatesPreservedModificationTime(t *testing.T) {
	for _, archive := range []bool{false, true} {
		name := "file"
		if archive {
			name = "archive"
		}
		t.Run(name, func(t *testing.T) {
			source := filepath.Join(t.TempDir(), "image.svg")
			oldImage := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="red"/></svg>`)
			newImage := bytes.Replace(oldImage, []byte("red"), []byte("tan"), 1)
			oldData, newData := oldImage, newImage
			imagePath := source
			if archive {
				source += ".zip"
				imagePath = source + "::image.svg"
				oldData = storedImageZIP(t, oldImage)
				newData = storedImageZIP(t, newImage)
			}
			if len(oldData) != len(newData) {
				t.Fatal("fixture must preserve byte count")
			}
			if err := os.WriteFile(source, oldData, 0600); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(source)
			if err != nil {
				t.Fatal(err)
			}
			if thumbnailFileIdentity(before) == "" {
				t.Skip("platform does not expose change-time identity")
			}
			services := New()
			defer services.Shutdown()
			payload, err := services.Library.LoadImageByPath(imagePath)
			if err != nil {
				t.Fatal(err)
			}
			handler := NewMediaMiddleware(services.Media)(http.NotFoundHandler())
			original := httptest.NewRecorder()
			handler.ServeHTTP(original, httptest.NewRequest(http.MethodGet, payload.DataURI, nil))
			if original.Code != http.StatusOK || !bytes.Equal(original.Body.Bytes(), oldImage) {
				t.Fatalf("original image: status=%d body=%q", original.Code, original.Body.Bytes())
			}
			if err := os.WriteFile(source, newData, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chtimes(source, before.ModTime(), before.ModTime()); err != nil {
				t.Fatal(err)
			}
			after, err := os.Stat(source)
			if err != nil {
				t.Fatal(err)
			}
			if !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
				t.Fatal("fixture must preserve inode, size and mtime")
			}
			if thumbnailFileIdentity(before) == thumbnailFileIdentity(after) {
				t.Fatal("fixture must change source identity")
			}
			request := httptest.NewRequest(http.MethodGet, payload.DataURI, nil)
			request.Header.Set("If-None-Match", original.Header().Get("ETag"))
			updated := httptest.NewRecorder()
			handler.ServeHTTP(updated, request)
			if updated.Code != http.StatusOK || !bytes.Equal(updated.Body.Bytes(), newImage) {
				t.Errorf("updated image reused stale HTTP content: status=%d body=%q", updated.Code, updated.Body.Bytes())
			}
			updatedPayload, err := services.Library.LoadImageByPath(imagePath)
			if err != nil {
				t.Fatal(err)
			}
			if updatedPayload.DataURI == payload.DataURI {
				t.Error("updated image retained stale browser URL")
			}
		})
	}
}

func storedImageZIP(t *testing.T, content []byte) []byte {
	t.Helper()
	var result bytes.Buffer
	archive := zip.NewWriter(&result)
	entry, err := archive.CreateHeader(&zip.FileHeader{Name: "image.svg", Method: zip.Store})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return result.Bytes()
}

func TestRegisteredHTTPFileReplacementWithFIFO(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("named pipe fixture requires Unix")
	}
	for _, extension := range []string{".svg", ".pdf", ".mp4"} {
		t.Run(extension, func(t *testing.T) {
			source := filepath.Join(t.TempDir(), "document"+extension)
			if err := os.WriteFile(source, []byte("original regular file"), 0600); err != nil {
				t.Fatal(err)
			}
			services := New()
			defer services.Shutdown()
			var urlPath string
			if extension == ".pdf" {
				var err error
				urlPath, err = services.Library.PrepareDocumentByPath(source, 0)
				if err != nil {
					t.Fatal(err)
				}
			} else if extension == ".mp4" {
				var err error
				urlPath, err = services.Media.PrepareMediaByPath(source, 0)
				if err != nil {
					t.Fatal(err)
				}
			} else {
				payload, err := services.Library.LoadImageByPath(source)
				if err != nil {
					t.Fatal(err)
				}
				urlPath = payload.DataURI
			}
			if err := os.Remove(source); err != nil {
				t.Fatal(err)
			}
			if output, err := exec.Command("mkfifo", source).CombinedOutput(); err != nil {
				t.Fatalf("mkfifo: %v: %s", err, output)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			request := httptest.NewRequest(http.MethodGet, urlPath, nil).WithContext(ctx)
			result := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				response := httptest.NewRecorder()
				NewMediaMiddleware(services.Media)(http.NotFoundHandler()).ServeHTTP(response, request)
				result <- response
			}()
			select {
			case response := <-result:
				if response.Code != http.StatusNotFound {
					t.Fatalf("special file status = %d, expected 404", response.Code)
				}
			case <-time.After(300 * time.Millisecond):
				cancel()
				// Release the old blocking implementation so a failing test never
				// leaves a reader or media lifecycle lock behind.
				writer, err := os.OpenFile(source, os.O_RDWR, 0600)
				if err != nil {
					t.Fatal(err)
				}
				_ = writer.Close()
				select {
				case <-result:
				case <-time.After(2 * time.Second):
					t.Fatal("FIFO reader did not stop after writer connected")
				}
				t.Fatal("registered file replaced by FIFO blocked HTTP request")
			}
		})
	}
}

func TestRegularFileReadPreservesSymlinksAndRejectsSpecialTargets(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink fixture requires unprivileged Unix symlinks")
	}
	root := t.TempDir()
	source := filepath.Join(root, "original.txt")
	link := filepath.Join(root, "linked.txt")
	if err := os.WriteFile(source, []byte("linked regular content"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(source, link); err != nil {
		t.Fatal(err)
	}
	file, err := openRegularFile(link)
	if err != nil {
		t.Fatal(err)
	}
	content, readErr := io.ReadAll(file)
	closeErr := file.Close()
	if readErr != nil || closeErr != nil || string(content) != "linked regular content" {
		t.Fatalf("regular symlink read = %q, read error = %v, close error = %v", content, readErr, closeErr)
	}
	if err := os.Remove(source); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("mkfifo", source).CombinedOutput(); err != nil {
		t.Fatalf("mkfifo: %v: %s", err, output)
	}
	for _, path := range []string{root, source, link, "/dev/null"} {
		file, err := openRegularFile(path)
		if file != nil {
			_ = file.Close()
		}
		if !errors.Is(err, errNotRegularFile) {
			t.Errorf("opening special target %q: expected errNotRegularFile, got %v", path, err)
		}
	}
}

func TestNonblockingFileOpenDoesNotWaitForFIFOWriter(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("named pipe fixture requires Unix")
	}
	source := filepath.Join(t.TempDir(), "replaced.txt")
	if output, err := exec.Command("mkfifo", source).CombinedOutput(); err != nil {
		t.Fatalf("mkfifo: %v: %s", err, output)
	}
	// Exercise the actual open primitive, covering the Stat/Open race in which
	// openRegularFile's first metadata check saw a regular file before replacement.
	result := make(chan error, 1)
	go func() {
		file, err := openFileWithoutBlocking(source)
		if file != nil {
			_ = file.Close()
		}
		result <- err
	}()
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(300 * time.Millisecond):
		writer, err := os.OpenFile(source, os.O_RDWR, 0600)
		if err != nil {
			t.Fatal(err)
		}
		_ = writer.Close()
		<-result
		t.Fatal("file-open primitive blocked waiting for a FIFO writer")
	}
}
