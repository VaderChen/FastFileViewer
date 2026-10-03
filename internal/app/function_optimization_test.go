package app

import (
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/rand"
	"reflect"
	"strings"
	"testing"
	"unicode/utf16"

	"golang.org/x/text/encoding/simplifiedchinese"
)

func checkTextFunctionCompatibility(t *testing.T, data []byte) {
	t.Helper()
	text := string(data)
	if got, want := normalizeLineEndings(text), referenceNormalizeLineEndings(text); got != want {
		t.Fatalf("line endings differ for %x: %q != %q", data, got, want)
	}
	if got, want := normalizedExtension(text), referenceNormalizedExtension(text); got != want {
		t.Fatalf("extension differs for %x: %q != %q", data, got, want)
	}
	if got, want := normalizeArchiveEntryName(text), referenceNormalizeArchiveEntryName(text); got != want {
		t.Fatalf("archive name differs for %x: %q != %q", data, got, want)
	}
	if got, want := decodeDocumentText(data), referenceDecodeDocumentText(data); got != want {
		t.Fatalf("document differs for %x: %q != %q", data, got, want)
	}
	got, ok := decodeUTF16Document(data)
	want, wantOK := referenceDecodeUTF16Document(data)
	if got != want || ok != wantOK {
		t.Fatalf("UTF-16 differs for %x: (%q,%v) != (%q,%v)", data, got, ok, want, wantOK)
	}
}

func TestFunctionTextCompatibility(t *testing.T) {
	cases := []string{"", "plain text", "\r\r\n\n\r", "\ufeff繁體中文\r\n日本語", "\xff\r\xfe", "\x00", "folder/MAKEFILE", "folder/MaKefile", "folder/.GITIGNORE", "folder/FILE.TAR.GZ", "folder/FILE.tar.Gz/", "a::b::c.png", "a/\ufffd.png"}
	for _, value := range cases {
		checkTextFunctionCompatibility(t, []byte(value))
	}
	random := rand.New(rand.NewSource(48))
	for range 1000 {
		data := make([]byte, random.Intn(256))
		_, _ = random.Read(data)
		checkTextFunctionCompatibility(t, data)
	}
}

func FuzzFunctionTextCompatibility(f *testing.F) {
	for _, data := range [][]byte{nil, []byte("a\r\n\r\nb.TAR.GZ"), []byte("MaKefile"), {0xff, 0xfe, 0, 0xd8, 0, 0xdc}, {0xfe, 0xff, 0xdc, 0, 0xd8, 0}, {0xef, 0xbf, 0xbd, 0xff}} {
		f.Add(data)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 8192 {
			return
		}
		checkTextFunctionCompatibility(t, data)
	})
}

func TestUTF16AllCodeUnitsAndMalformedPairs(t *testing.T) {
	for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
		data := make([]byte, 6)
		order.PutUint16(data, 0xfeff)
		for value := 0; value <= 0xffff; value++ {
			order.PutUint16(data[2:], uint16(value))
			for _, tail := range []uint16{0x61, 0xd800, 0xdc00} {
				order.PutUint16(data[4:], tail)
				got, ok := decodeUTF16Document(data)
				want, _ := referenceDecodeUTF16Document(data)
				if !ok || got != want {
					t.Fatalf("UTF-16 unit %x/%x differs", value, tail)
				}
			}
		}
	}
}

func TestArchiveTreeFunctionCompatibility(t *testing.T) {
	got, want := buildArchiveNode("fixture.zip"), buildArchiveNode("fixture.zip")
	indexes, oldIndexes := make(map[string]map[string]int), make(map[string]map[string]int)
	for index := range 1200 {
		inner := fmt.Sprintf("folder-%d/shared/deep/資料/%d.png", index%100, index)
		if index%7 == 0 {
			inner = fmt.Sprintf("root-%d.png", index)
		}
		entry := buildArchiveImageEntry(got.Path, inner, int64(index))
		addArchiveImageToNode(&got, entry, indexes)
		referenceAddArchiveImageToNode(&want, entry, oldIndexes)
	}
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(indexes, oldIndexes) {
		t.Fatal("archive tree order, paths, IDs or sibling indexes changed")
	}
}

func TestHashIDPreservesZeroDelimitedParts(t *testing.T) {
	for _, parts := range [][]string{nil, {""}, {"a", "b"}, {"ab"}, {"a\x00b", ""}, {"archive", "fixture.zip", "資料/檔案.png"}, {strings.Repeat("long-path/", 1000)}} {
		encoded := ""
		for _, part := range parts {
			encoded += part + "\x00"
		}
		digest := sha1.Sum([]byte(encoded))
		if got, want := hashID(parts...), hex.EncodeToString(digest[:]); got != want {
			t.Fatalf("ID changed: %q", parts)
		}
	}
}

var functionStringSink string
var functionTreeSink LibraryNode

func BenchmarkFunctionHashID(b *testing.B) {
	for _, impl := range []struct {
		name string
		run  func(...string) string
	}{{"before", referenceHashID}, {"after", hashID}} {
		b.Run(impl.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				functionStringSink = impl.run("archive", "fixture.zip", "folder/圖片.png")
			}
		})
	}
}

func BenchmarkFunctionText(b *testing.B) {
	benchmark := func(name, input string, before, after func(string) string) {
		for _, impl := range []struct {
			name string
			run  func(string) string
		}{{"before", before}, {"after", after}} {
			b.Run(name+"/"+impl.name, func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(input)))
				for b.Loop() {
					functionStringSink = impl.run(input)
				}
			})
		}
	}
	benchmark("long-extension", strings.Repeat("Library/相片/", 30)+"Picture.JPG", referenceNormalizedExtension, normalizedExtension)
	benchmark("mixed-newlines", strings.Repeat("first\r\n第二行\rlast\n", 8192), referenceNormalizeLineEndings, normalizeLineEndings)
	benchmark("unchanged-newlines", strings.Repeat("first\n第二行\nlast\n", 8192), referenceNormalizeLineEndings, normalizeLineEndings)
	legacyName, _ := simplifiedchinese.GBK.NewEncoder().String("資料/圖片測試/照片.jpg")
	benchmark("legacy-archive-name", legacyName, referenceNormalizeArchiveEntryName, normalizeArchiveEntryName)
	for _, sample := range []struct{ name, text string }{{"ascii", "code text\r\n"}, {"cjk", "繁體中文日本語\r\n"}, {"emoji", "音樂🎵😀\r\n"}} {
		units := utf16.Encode([]rune(strings.Repeat(sample.text, 8192)))
		data := make([]byte, 2+2*len(units))
		binary.LittleEndian.PutUint16(data, 0xfeff)
		for index, unit := range units {
			binary.LittleEndian.PutUint16(data[2+index*2:], unit)
		}
		for _, impl := range []struct {
			name string
			run  func([]byte) (string, bool)
		}{{"before", referenceDecodeUTF16Document}, {"after", decodeUTF16Document}} {
			b.Run("utf16-"+sample.name+"/"+impl.name, func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(int64(len(data)))
				for b.Loop() {
					functionStringSink, _ = impl.run(data)
				}
			})
		}
	}
	legacyDocument, _ := simplifiedchinese.GB18030.NewEncoder().Bytes([]byte(strings.Repeat("文件內容測試\r\n", 8192)))
	for _, impl := range []struct {
		name string
		run  func([]byte) string
	}{{"before", referenceDecodeDocumentText}, {"after", decodeDocumentText}} {
		b.Run("legacy-document/"+impl.name, func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(legacyDocument)))
			for b.Loop() {
				functionStringSink = impl.run(legacyDocument)
			}
		})
	}
}

func BenchmarkFunctionArchiveTree(b *testing.B) {
	entries := make([]ImageEntry, 5000)
	for index := range entries {
		entries[index] = buildArchiveImageEntry("fixture.zip", fmt.Sprintf("shared/a/b/c/d/e/%d.png", index), 1)
	}
	for _, impl := range []struct {
		name string
		run  func(*LibraryNode, ImageEntry, map[string]map[string]int)
	}{{"before", referenceAddArchiveImageToNode}, {"after", addArchiveImageToNode}} {
		b.Run(impl.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				root := buildArchiveNode("fixture.zip")
				indexes := make(map[string]map[string]int)
				for _, entry := range entries {
					impl.run(&root, entry, indexes)
				}
				functionTreeSink = root
			}
		})
	}
}
