package app

import (
	"bytes"
	"container/list"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"golang.org/x/image/draw"
)

func thumbnailOptimizationFixture(t testing.TB, opaque bool, width, height int) []byte {
	t.Helper()
	picture := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			alpha := uint8((x*3 + y*7) % 256)
			if opaque {
				alpha = 255
			}
			picture.SetNRGBA(x, y, color.NRGBA{R: uint8(x * 11), G: uint8(y * 13), B: uint8(x + y), A: alpha})
		}
	}
	var output bytes.Buffer
	if err := png.Encode(&output, picture); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func thumbnailOptimizationSource(t testing.TB, data []byte) ImageEntry {
	t.Helper()
	path := filepath.Join(t.TempDir(), "sample.png")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return buildFileImageEntry(path, int64(len(data)))
}

func TestThumbnailOptimizationPreservesPNGBytes(t *testing.T) {
	for _, opaque := range []bool{false, true} {
		for _, dimension := range []int{80, 280, 640} {
			t.Run(fmt.Sprintf("opaque=%v/max=%d", opaque, dimension), func(t *testing.T) {
				data := thumbnailOptimizationFixture(t, opaque, 320, 180)
				entry := thumbnailOptimizationSource(t, data)
				decoded, err := png.Decode(bytes.NewReader(data))
				if err != nil {
					t.Fatal(err)
				}
				width, height := scaledDimensions(decoded.Bounds().Dx(), decoded.Bounds().Dy(), dimension)
				expectedImage := image.NewRGBA(image.Rect(0, 0, width, height))
				draw.BiLinear.Scale(expectedImage, expectedImage.Bounds(), decoded, decoded.Bounds(), draw.Over, nil)
				var expected bytes.Buffer
				encoder := png.Encoder{CompressionLevel: png.BestSpeed}
				if err := encoder.Encode(&expected, expectedImage); err != nil {
					t.Fatal(err)
				}
				for range 3 {
					actual, err := renderThumbnailWithContext(context.Background(), entry, dimension)
					if err != nil {
						t.Fatal(err)
					}
					if !bytes.Equal(actual, expected.Bytes()) {
						t.Fatal("thumbnail PNG content changed")
					}
				}
			})
		}
	}
}

func TestThumbnailOptimizationConcurrentRendering(t *testing.T) {
	data := thumbnailOptimizationFixture(t, false, 160, 120)
	entry := thumbnailOptimizationSource(t, data)
	expected, err := renderThumbnail(entry, 80)
	if err != nil {
		t.Fatal(err)
	}
	var workers sync.WaitGroup
	for range 12 {
		workers.Go(func() {
			actual, err := renderThumbnail(entry, 80)
			if err != nil {
				t.Error(err)
				return
			}
			if !bytes.Equal(actual, expected) {
				t.Error("parallel thumbnail content changed")
			}
		})
	}
	workers.Wait()
}

func TestThumbnailDiskCacheUpdatesSizeAndRecency(t *testing.T) {
	cache := &thumbnailDiskCache{entries: make(map[string]*list.Element)}
	cache.add("first.png", 10)
	cache.add("second.png", 20)
	cache.add("first.png", 30)
	if cache.bytes != 50 || len(cache.entries) != 2 || cache.lru.Len() != 2 {
		t.Fatalf("incorrect cache accounting: bytes=%d, entries=%d, lru=%d", cache.bytes, len(cache.entries), cache.lru.Len())
	}
	if cache.lru.Front() != cache.entries["second.png"] || cache.lru.Back() != cache.entries["first.png"] {
		t.Fatal("cache refresh did not retain the latest access order")
	}
	cache.forget("first.png")
	if cache.bytes != 20 || cache.lru.Front() != cache.entries["second.png"] {
		t.Fatal("cache removal used an outdated size")
	}
}

func BenchmarkThumbnailRenderReuse(b *testing.B) {
	entry := thumbnailOptimizationSource(b, thumbnailOptimizationFixture(b, false, 640, 480))
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, err := renderThumbnail(entry, 280); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkThumbnailDiskCacheHit(b *testing.B) {
	cache := &thumbnailDiskCache{entries: make(map[string]*list.Element)}
	paths := make([]string, 128)
	for index := range paths {
		paths[index] = fmt.Sprintf("%d.png", index)
		cache.add(paths[index], int64(index+1))
	}
	b.ReportAllocs()
	b.ResetTimer()
	for index := range b.N {
		slot := index % len(paths)
		cache.add(paths[slot], int64(slot+1))
	}
}

func TestThumbnailNoResizeMatchesBilinear(t *testing.T) {
	fixtures := []image.Image{
		image.NewRGBA(image.Rect(0, 0, 256, 256)),
		image.NewNRGBA(image.Rect(0, 0, 256, 256)),
		image.NewRGBA64(image.Rect(0, 0, 256, 256)),
		image.NewNRGBA64(image.Rect(0, 0, 256, 256)),
		image.NewGray(image.Rect(0, 0, 256, 256)),
		image.NewGray16(image.Rect(0, 0, 256, 256)),
	}
	for index, fixture := range fixtures {
		picture := fixture.(draw.Image)
		for y := 0; y < 256; y++ {
			for x := 0; x < 256; x++ {
				picture.Set(x, y, color.NRGBA64{R: uint16(x * 257), G: uint16(y * 257), B: uint16((x + y) * 127), A: uint16((x*37 + y*67) * 19)})
			}
		}
		var input bytes.Buffer
		if err := png.Encode(&input, picture); err != nil {
			t.Fatal(err)
		}
		t.Run(fmt.Sprintf("png-type-%d", index), func(t *testing.T) {
			assertThumbnailMatchesBilinear(t, input.Bytes(), "sample.png")
		})
	}
	for _, format := range []string{"jpeg", "gif"} {
		var input bytes.Buffer
		if format == "jpeg" {
			if err := jpeg.Encode(&input, fixtures[1], nil); err != nil {
				t.Fatal(err)
			}
		} else if err := gif.Encode(&input, fixtures[1], nil); err != nil {
			t.Fatal(err)
		}
		t.Run(format, func(t *testing.T) {
			assertThumbnailMatchesBilinear(t, input.Bytes(), "sample."+format)
		})
	}
}

func assertThumbnailMatchesBilinear(t *testing.T, data []byte, name string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	expectedImage := image.NewRGBA(decoded.Bounds())
	draw.BiLinear.Scale(expectedImage, expectedImage.Bounds(), decoded, decoded.Bounds(), draw.Over, nil)
	var expected bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := encoder.Encode(&expected, expectedImage); err != nil {
		t.Fatal(err)
	}
	actual, err := renderThumbnail(buildFileImageEntry(path, int64(len(data))), 640)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, expected.Bytes()) {
		t.Fatal("unscaled thumbnail differs from existing bilinear rendering")
	}
}

func BenchmarkThumbnailUnscaledReuse(b *testing.B) {
	entry := thumbnailOptimizationSource(b, thumbnailOptimizationFixture(b, false, 256, 256))
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, err := renderThumbnail(entry, 280); err != nil {
			b.Fatal(err)
		}
	}
}
