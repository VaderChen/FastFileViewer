package app

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func round6Archive(t testing.TB, format string) string {
	t.Helper()
	filename := filepath.Join(t.TempDir(), "entries."+format)
	var data bytes.Buffer
	if format == "zip" {
		writer := zip.NewWriter(&data)
		for _, item := range []struct {
			name, text string
			mode       os.FileMode
		}{
			{"alias.txt", "elsewhere", os.ModeSymlink | 0600},
			{"same.txt", "first", 0600}, {"./same.txt", "second", 0600},
			{"alias.txt", "regular", 0600}, {"empty.txt", "", 0600},
		} {
			h := &zip.FileHeader{Name: item.name, Method: zip.Store}
			h.SetMode(item.mode)
			entry, err := writer.CreateHeader(h)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = io.WriteString(entry, item.text); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
	} else {
		writer := tar.NewWriter(&data)
		for _, item := range []struct {
			name, text string
			kind       byte
		}{
			{"alias.txt", "", tar.TypeSymlink}, {"same.txt", "first", tar.TypeReg},
			{"./same.txt", "second", tar.TypeReg}, {"alias.txt", "regular", tar.TypeReg},
			{"empty.txt", "", tar.TypeReg}, {"pipe.txt", "", tar.TypeFifo},
		} {
			h := &tar.Header{Name: item.name, Mode: 0600, Size: int64(len(item.text)), Typeflag: item.kind}
			if item.kind == tar.TypeSymlink {
				h.Linkname = "elsewhere"
			}
			if err := writer.WriteHeader(h); err != nil {
				t.Fatal(err)
			}
			if _, err := io.WriteString(writer, item.text); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filename, data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	return filename
}

func TestArchiveScanListsFirstReadableEntryOnce(t *testing.T) {
	for _, format := range []string{"zip", "tar"} {
		t.Run(format, func(t *testing.T) {
			filename := round6Archive(t, format)
			scan := scanZipArchiveImages
			if format == "tar" {
				scan = scanTarArchiveImages
			}
			entries, err := scan(context.Background(), filename, nil, map[string]bool{".txt": true}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 3 {
				t.Fatalf("want three unique readable files, got %d", len(entries))
			}
			seen := map[string]bool{}
			for _, entry := range entries {
				if seen[entry.ID] {
					t.Fatalf("duplicate entry ID for %s", entry.InnerPath)
				}
				seen[entry.ID] = true
				if entry.InnerPath == "same.txt" && entry.Size != 5 {
					t.Fatal("duplicate metadata must describe the first readable entry")
				}
			}
		})
	}
}

func TestArchiveReadersAgreeOnFirstReadableEntry(t *testing.T) {
	for _, format := range []string{"zip", "tar"} {
		t.Run(format, func(t *testing.T) {
			filename := round6Archive(t, format)
			z := &zipIndexCache{items: make(map[string]*cachedZIP)}
			defer z.clear()
			c := &tarIndexCache{items: make(map[string]*cachedTAR)}
			defer c.clear()
			readers := []func(context.Context, ImageEntry) (io.ReadCloser, error){z.open}
			if format == "tar" {
				readers = []func(context.Context, ImageEntry) (io.ReadCloser, error){c.open, openTarEntryReaderUncached}
			}
			for _, open := range readers {
				for name, want := range map[string]string{"alias.txt": "regular", "same.txt": "first", "empty.txt": ""} {
					reader, err := open(context.Background(), buildArchiveImageEntry(filename, name, 0))
					if err != nil {
						t.Fatal(err)
					}
					got, err := io.ReadAll(reader)
					_ = reader.Close()
					if err != nil || string(got) != want {
						t.Fatalf("%s: got %q, want %q, err=%v", name, got, want, err)
					}
				}
			}
		})
	}
}

type archiveBuildCancelContext struct {
	context.Context
	calls, limit int
	done         chan struct{}
}

func (ctx *archiveBuildCancelContext) Done() <-chan struct{} {
	ctx.calls++
	if ctx.calls == ctx.limit {
		close(ctx.done)
	}
	return ctx.done
}
func TestArchiveTreeBuildChecksCancellationAfterListing(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "images.zip")
	writeZipEntry(t, filename, "nested/image.png", []byte("sample"))
	ctx := &archiveBuildCancelContext{Context: context.Background(), limit: 2, done: make(chan struct{})}
	services := New()
	defer services.Shutdown()
	_, err := services.Library.scanArchiveNode(ctx, filename, map[string]bool{".png": true}, nil, nil)
	if !errors.Is(err, errOperationCancelled) {
		t.Fatalf("tree assembly ignored cancellation: %v", err)
	}
}

func BenchmarkWideArchiveTree(b *testing.B) {
	entries := make([]ImageEntry, 6000)
	for i := range entries {
		entries[i] = buildArchiveImageEntry("fixture.zip", fmt.Sprintf("folder-%05d/sample.png", i), 1)
	}
	b.ReportAllocs()
	for b.Loop() {
		root := buildArchiveNode("fixture.zip")
		indexes := make(map[string]map[string]int)
		for _, entry := range entries {
			addArchiveImageToNode(&root, entry, indexes)
		}
		sortLibraryNode(&root)
		if len(root.Children) != len(entries) {
			b.Fatal("lost archive folders")
		}
	}
}

func TestArchiveTreePreservesAllNestedEntries(t *testing.T) {
	root := buildArchiveNode("fixture.zip")
	indexes := make(map[string]map[string]int)
	expected := make(map[string]bool)
	for i := 0; i < 500; i++ {
		for _, prefix := range []string{"common/", ""} {
			entry := buildArchiveImageEntry(root.Path, fmt.Sprintf("%sfolder-%03d/deep/sample.txt", prefix, i), 1)
			addArchiveImageToNode(&root, entry, indexes)
			expected[entry.ID] = true
		}
	}
	sortLibraryNode(&root)
	pending := []*LibraryNode{&root}
	for len(pending) > 0 {
		node := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		for _, entry := range node.Images {
			if !expected[entry.ID] {
				t.Fatal("duplicate or misplaced entry")
			}
			delete(expected, entry.ID)
		}
		for i := range node.Children {
			if i > 0 && strings.ToLower(node.Children[i-1].Name) > strings.ToLower(node.Children[i].Name) {
				t.Fatal("changed directory sort order")
			}
			pending = append(pending, &node.Children[i])
		}
	}
	if len(expected) != 0 {
		t.Fatalf("lost %d entries", len(expected))
	}
}

func TestArchiveNamesPreserveValidUnicode(t *testing.T) {
	for _, name := range []string{"测试/图片.png", "中文/說明.txt", "日本語/写真.jpg", "café/🎵.mp3"} {
		if got := normalizeArchiveEntryName(name); got != name {
			t.Errorf("valid Unicode name changed: got %q, want %q", got, name)
		}
	}
}

type archiveMutationContext struct {
	context.Context
	mutate func()
}

func (ctx *archiveMutationContext) Done() <-chan struct{} {
	if ctx.mutate != nil {
		mutate := ctx.mutate
		ctx.mutate = nil
		mutate()
	}
	return nil
}

func TestTARIndexRejectsSourceChangedDuringBuild(t *testing.T) {
	for _, replace := range []bool{false, true} {
		t.Run(fmt.Sprintf("replace=%v", replace), func(t *testing.T) {
			filename := round6Archive(t, "tar")
			before, err := os.Stat(filename)
			if err != nil {
				t.Fatal(err)
			}
			ctx := &archiveMutationContext{Context: context.Background(), mutate: func() {
				if replace {
					data, err := os.ReadFile(filename)
					if err != nil {
						t.Fatal(err)
					}
					replacement := filename + ".new"
					if err := os.WriteFile(replacement, data, 0600); err != nil {
						t.Fatal(err)
					}
					if err := os.Rename(replacement, filename); err != nil {
						t.Fatal(err)
					}
				} else {
					changed := before.ModTime().Add(2 * time.Second)
					if err := os.Chtimes(filename, changed, changed); err != nil {
						t.Fatal(err)
					}
				}
			}}
			item, err := buildTARIndex(ctx, filename, before)
			if item != nil && item.file != nil {
				defer os.Remove(item.file.Name())
				defer item.file.Close()
			}
			if err == nil {
				t.Fatal("published a TAR index after its source changed")
			}
			if item != nil {
				t.Fatal("returned a partially built cache")
			}
		})
	}
}
