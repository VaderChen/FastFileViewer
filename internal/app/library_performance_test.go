package app

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestDuplicateDetectionPreservesGroupsAndInput(t *testing.T) {
	directory := t.TempDir()
	large := bytes.Repeat([]byte("image content"), 6500)
	small := []byte("short final buffer")
	contents := [][]byte{large, large, small, small, {}, {}, []byte("different data")}
	entries := make([]ImageEntry, 0, len(contents)+2)
	for index, data := range contents {
		filePath := filepath.Join(directory, fmt.Sprintf("sample-%d.txt", index))
		if err := os.WriteFile(filePath, data, 0600); err != nil {
			t.Fatal(err)
		}
		// Size is scanned metadata and can precede a file update. Keep the
		// original policy of grouping candidates by that metadata.
		entries = append(entries, buildFileImageEntry(filePath, 100000))
	}
	archivePath := filepath.Join(directory, "sample.zip")
	archive, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(archive)
	member, err := writer.Create("packed.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := member.Write(large); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(archiveZIPs.clear)
	entries = append(entries, buildArchiveImageEntry(archivePath, "packed.txt", 100000))
	entries = append(entries, buildFileImageEntry(filepath.Join(directory, "missing.txt"), 100000))
	original := append([]ImageEntry(nil), entries...)
	groups, err := New().Library.DetectDuplicates(entries, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 3 || len(groups[0].Images) != 3 {
		t.Fatalf("unexpected groups: %#v", groups)
	}
	wantByHash := make(map[string][]ImageEntry)
	for index, data := range contents[:6] {
		sum := sha256.Sum256(data)
		key := hex.EncodeToString(sum[:])
		wantByHash[key] = append(wantByHash[key], entries[index])
	}
	largeSum := sha256.Sum256(large)
	largeHash := hex.EncodeToString(largeSum[:])
	wantByHash[largeHash] = append(wantByHash[largeHash], entries[7])
	for _, group := range groups {
		if !reflect.DeepEqual(group.Images, wantByHash[group.Hash]) || group.TotalBytes != int64(len(group.Images))*100000 {
			t.Fatalf("duplicate membership, order, or byte total changed: %#v", group)
		}
	}
	groups[0].Images[0].Name = "changed-result"
	if !reflect.DeepEqual(entries, original) {
		t.Fatal("duplicate detection aliased or mutated the input")
	}
}

func TestDuplicateDetectionPreservesCancellation(t *testing.T) {
	application := New().Library
	operation := application.BeginOperation()
	application.CancelOperation(operation)
	groups, err := application.DetectDuplicates([]ImageEntry{{Size: 10}, {Size: 10}}, operation)
	if !errors.Is(err, errOperationCancelled) || groups != nil {
		t.Fatalf("cancelled detection returned %v, %v", groups, err)
	}
}

func TestLibrarySortingPreservesStableLowercaseOrder(t *testing.T) {
	names := []string{"a.PNG", "A.png", "a.png", "圖片甲.png", "圖片乙.png", "İ.png", "i.png", "K.png", "K.png", "Σ.png", "σ.png", "ς.png", "É.png", "é.png", "éa.png", "", "\xffZ", "\xfeA", "\ufffdz", "\x00A"}
	random := rand.New(rand.NewSource(913))
	for index := 0; index < 1000; index++ {
		name := make([]byte, random.Intn(24))
		_, _ = random.Read(name)
		names = append(names, string(name))
	}
	root := LibraryNode{}
	for index, name := range names {
		id := fmt.Sprint(index)
		root.Images = append(root.Images, ImageEntry{ID: id, Name: name})
		for _, kind := range []string{"directory", "archive"} {
			root.Children = append(root.Children, LibraryNode{ID: kind + id, Name: name, Kind: kind})
		}
	}
	wantImages := append([]ImageEntry(nil), root.Images...)
	wantChildren := append([]LibraryNode(nil), root.Children...)
	sort.SliceStable(wantImages, func(i, j int) bool {
		return strings.ToLower(wantImages[i].Name) < strings.ToLower(wantImages[j].Name)
	})
	sort.SliceStable(wantChildren, func(i, j int) bool {
		if wantChildren[i].Kind != wantChildren[j].Kind {
			return kindRank(wantChildren[i].Kind) < kindRank(wantChildren[j].Kind)
		}
		return strings.ToLower(wantChildren[i].Name) < strings.ToLower(wantChildren[j].Name)
	})
	sortLibraryNode(&root)
	if !reflect.DeepEqual(root.Images, wantImages) || !reflect.DeepEqual(root.Children, wantChildren) {
		t.Fatal("sorting changed the stable lowercase name or folder/archive order")
	}
}

func FuzzLowercaseNameOrder(f *testing.F) {
	for _, pair := range [][2]string{{"", "A"}, {"A.png", "a.png"}, {"İ", "i"}, {"K", "k"}, {"Σ", "ς"}, {"圖片", "Été"}, {"\xffZ", "\ufffdz"}, {"\xfeA", "\xffb"}} {
		f.Add(pair[0], pair[1])
	}
	f.Fuzz(func(t *testing.T, left, right string) {
		if got, want := lessLowercaseName(left, right), strings.ToLower(left) < strings.ToLower(right); got != want {
			t.Fatalf("lowercase order differs for %q and %q: got %v, want %v", left, right, got, want)
		}
	})
}

func BenchmarkLibraryNameSort(b *testing.B) {
	for _, family := range []string{"ASCII", "Unicode"} {
		b.Run(family, func(b *testing.B) {
			random := rand.New(rand.NewSource(912))
			images := make([]ImageEntry, 5000)
			for index := range images {
				prefix := "Album_Summer_IMG_"
				if family == "Unicode" {
					prefix = "相簿_Été_圖片_"
				}
				images[index] = ImageEntry{ID: fmt.Sprint(index), Name: fmt.Sprintf("%s%06d.JPG", prefix, random.Intn(5000))}
			}
			root := LibraryNode{Images: make([]ImageEntry, len(images))}
			b.ReportAllocs()
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				copy(root.Images, images)
				sortLibraryNode(&root)
			}
		})
	}
}

func BenchmarkDuplicateDetection(b *testing.B) {
	b.Run("UniqueSizes", func(b *testing.B) {
		entries := make([]ImageEntry, 20000)
		for index := range entries {
			entries[index] = ImageEntry{ID: fmt.Sprint(index), Size: int64(index)}
		}
		application := New().Library
		b.ReportAllocs()
		b.ResetTimer()
		for index := 0; index < b.N; index++ {
			if groups, err := application.DetectDuplicates(entries, 0); err != nil || len(groups) != 0 {
				b.Fatalf("unexpected duplicate detection: %v, %v", groups, err)
			}
		}
	})
	b.Run("SameSizeFiles", func(b *testing.B) {
		directory := b.TempDir()
		entries := make([]ImageEntry, 256)
		for index := range entries {
			data := bytes.Repeat([]byte{byte(index)}, 4096)
			filePath := filepath.Join(directory, fmt.Sprintf("sample-%d.bin", index))
			if err := os.WriteFile(filePath, data, 0600); err != nil {
				b.Fatal(err)
			}
			entries[index] = buildFileImageEntry(filePath, int64(len(data)))
		}
		application := New().Library
		b.ReportAllocs()
		b.ResetTimer()
		for index := 0; index < b.N; index++ {
			if groups, err := application.DetectDuplicates(entries, 0); err != nil || len(groups) != 0 {
				b.Fatalf("unexpected duplicate detection: %v, %v", groups, err)
			}
		}
	})
}
