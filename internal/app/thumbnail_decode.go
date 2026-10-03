package app

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"io"
	"sync"

	"golang.org/x/image/draw"
)

// 限制同時解碼的總像素，避免三張最大尺寸圖片同時占用記憶體。
// 不包含解碼器工作區及 Go GC 尚未回收的物件。
var thumbnailPixels = newPixelBudget(maxDecodedImagePixels)

type pixelBudget struct {
	mu          sync.Mutex
	limit, used int64
	changed     chan struct{}
}

func newPixelBudget(limit int64) *pixelBudget {
	return &pixelBudget{limit: limit, changed: make(chan struct{})}
}

func (budget *pixelBudget) acquire(ctx context.Context, pixels int64) error {
	if pixels <= 0 || pixels > budget.limit {
		return fmt.Errorf("圖片尺寸超過解碼預算")
	}
	for {
		if err := checkOperation(ctx); err != nil {
			return err
		}
		budget.mu.Lock()
		if budget.used+pixels <= budget.limit {
			budget.used += pixels
			budget.mu.Unlock()
			return nil
		}
		changed := budget.changed
		budget.mu.Unlock()
		select {
		case <-ctx.Done():
			return errOperationCancelled
		case <-changed:
		}
	}
}

func (budget *pixelBudget) release(pixels int64) {
	budget.mu.Lock()
	defer budget.mu.Unlock()
	budget.used -= pixels
	close(budget.changed)
	budget.changed = make(chan struct{})
}

func renderThumbnail(entry ImageEntry, maxDimension int) ([]byte, error) {
	return renderThumbnailWithContext(context.Background(), entry, maxDimension)
}

func renderThumbnailWithContext(ctx context.Context, entry ImageEntry, maxDimension int) ([]byte, error) {
	if err := checkOperation(ctx); err != nil {
		return nil, err
	}
	if entry.Size > maxThumbnailInputBytes {
		return nil, fmt.Errorf("%s 超過縮圖讀取上限", entry.Name)
	}
	reader, err := openEntryReader(ctx, entry)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	limited := &io.LimitedReader{R: reader, N: maxThumbnailInputBytes + 1}
	// 只暫存 DecodeConfig 讀過的前綴，後續解碼直接讀來源串流。
	var header bytes.Buffer
	config, _, err := image.DecodeConfig(io.TeeReader(limited, &header))
	if err != nil {
		return nil, fmt.Errorf("無法產生 %s 縮圖: %w", entry.Name, err)
	}
	if err := validateImageDimensions(config.Width, config.Height); err != nil {
		return nil, err
	}
	pixels := int64(config.Width) * int64(config.Height)
	if err := thumbnailPixels.acquire(ctx, pixels); err != nil {
		return nil, err
	}
	defer thumbnailPixels.release(pixels)
	decoded, _, err := image.Decode(io.MultiReader(bytes.NewReader(header.Bytes()), limited))
	if err != nil {
		return nil, fmt.Errorf("無法解碼 %s: %w", entry.Name, err)
	}
	// 包含尾端附加內容及 ZIP CRC，維持原本的完整讀取驗證。
	if _, err := io.Copy(io.Discard, limited); err != nil {
		return nil, err
	}
	if limited.N == 0 {
		return nil, fmt.Errorf("%s 超過縮圖讀取上限", entry.Name)
	}
	bounds := decoded.Bounds()
	width, height := scaledDimensions(bounds.Dx(), bounds.Dy(), maxDimension)
	thumbnail := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.BiLinear.Scale(thumbnail, thumbnail.Bounds(), decoded, bounds, draw.Over, nil)
	var encoded bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := encoder.Encode(&encoded, thumbnail); err != nil {
		return nil, err
	}
	if err := checkOperation(ctx); err != nil {
		return nil, err
	}
	return encoded.Bytes(), nil
}
