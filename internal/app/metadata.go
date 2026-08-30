package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	"io"
	"math"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/rwcarlsen/goexif/exif"
)

const metadataReadLimit int64 = 16 * 1024 * 1024

var rawImageExtensions = map[string]bool{
	".dng": true, ".crw": true, ".cr2": true, ".cr3": true, ".nef": true, ".nrw": true,
	".arw": true, ".srf": true, ".sr2": true, ".raf": true, ".orf": true,
	".rw2": true, ".rwl": true, ".pef": true, ".dcr": true, ".kdc": true,
	".3fr": true, ".iiq": true, ".mef": true, ".mos": true, ".x3f": true, ".raw": true,
	".srw": true, ".erf": true, ".mrw": true, ".gpr": true, ".bay": true, ".cap": true,
	".r3d": true, ".fff": true, ".ptx": true, ".pxn": true,
}

func isRawImage(extension string) bool {
	return rawImageExtensions[strings.ToLower(extension)]
}

// GetImageMetadata 讀取圖片尺寸、色彩模型及常見 EXIF 欄位。
func (a *App) GetImageMetadata(entry ImageEntry) (ImageMetadata, error) {
	if entry.Kind != "image" {
		return ImageMetadata{}, fmt.Errorf("不是圖片檔案: %s", entry.Name)
	}
	data, err := readMetadataBytes(entry)
	if err != nil {
		return ImageMetadata{}, err
	}
	exifData := data
	if isRawImage(entry.Format) {
		// 直接檔案交給 ImageIO 讀取完整來源；壓縮檔則使用已讀取的資料建立暫存檔。
		rawSource := data
		if entry.Source != "archive" {
			rawSource = nil
		}
		data, err = convertRawImageToPNG(context.Background(), entry, rawSource)
		if err != nil {
			return ImageMetadata{}, err
		}
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return ImageMetadata{}, fmt.Errorf("讀取圖片資訊失敗: %w", err)
	}
	metadata := ImageMetadata{Width: config.Width, Height: config.Height, ColorModel: colorModelName(config.ColorModel)}
	decoded, err := exif.Decode(bytes.NewReader(exifData))
	if err != nil {
		// PNG、WebP 等格式通常沒有 EXIF；尺寸資訊仍可正常提供。
		return metadata, nil
	}
	metadata.Orientation = exifValue(decoded, exif.Orientation)
	metadata.Make = exifValue(decoded, exif.Make)
	metadata.Model = exifValue(decoded, exif.Model)
	metadata.LensModel = exifValue(decoded, exif.LensModel)
	metadata.DateTimeOriginal = exifValue(decoded, exif.DateTimeOriginal)
	metadata.ExposureTime = exifValue(decoded, exif.ExposureTime)
	metadata.FNumber = exifValue(decoded, exif.FNumber)
	metadata.ISO = exifValue(decoded, exif.ISOSpeedRatings)
	metadata.FocalLength = exifValue(decoded, exif.FocalLength)
	metadata.GPS = formatGPS(decoded)
	return metadata, nil
}

func colorModelName(model color.Model) string {
	switch model {
	case color.RGBAModel:
		return "RGBA"
	case color.NRGBAModel:
		return "NRGBA"
	case color.RGBA64Model:
		return "RGBA64"
	case color.NRGBA64Model:
		return "NRGBA64"
	case color.GrayModel:
		return "Gray"
	case color.Gray16Model:
		return "Gray16"
	case color.CMYKModel:
		return "CMYK"
	case color.YCbCrModel:
		return "YCbCr"
	default:
		return ""
	}
}

func readMetadataBytes(entry ImageEntry) ([]byte, error) {
	readLimit := metadataReadLimit
	if isRawImage(entry.Format) {
		// RAW 必須提供完整來源給 ImageIO，否則截斷的感測器資料無法解碼。
		readLimit = maxImageBytes
	}
	if entry.Size > readLimit {
		// EXIF 通常位於檔案前段；大圖只讀取受限前綴，避免資訊面板拖慢預覽。
		reader, err := openEntryReader(context.Background(), entry)
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		return io.ReadAll(io.LimitReader(reader, readLimit))
	}
	return readEntryLimited(entry, readLimit)
}

// convertRawImageToPNG 使用 macOS ImageIO（sips）將 RAW 轉成 PNG，避免在專案內維護各家相機解碼器。
// archive 項目會先寫入暫存檔；輸出只保留於記憶體，不會修改來源檔案。
func convertRawImageToPNG(operationCtx context.Context, entry ImageEntry, rawData []byte) ([]byte, error) {
	if runtime.GOOS != "darwin" {
		return nil, fmt.Errorf("RAW 預覽目前需要 macOS ImageIO 支援: %s", entry.Name)
	}
	sourcePath := entry.Path
	temporarySource := ""
	if entry.Source == "archive" || sourcePath == "" {
		suffix := entry.Format
		if suffix == "" {
			suffix = ".raw"
		}
		file, err := os.CreateTemp("", "fastfileviewer-raw-*-"+suffix)
		if err != nil {
			return nil, fmt.Errorf("建立 RAW 暫存檔失敗: %w", err)
		}
		temporarySource = file.Name()
		defer os.Remove(temporarySource)
		if rawData == nil {
			reader, openErr := openEntryReader(operationCtx, entry)
			if openErr != nil {
				_ = file.Close()
				return nil, openErr
			}
			_, err = io.Copy(file, io.LimitReader(reader, maxImageBytes+1))
			_ = reader.Close()
		} else {
			_, err = file.Write(rawData)
		}
		if closeErr := file.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			return nil, fmt.Errorf("寫入 RAW 暫存檔失敗: %w", err)
		}
		sourcePath = temporarySource
	}
	outputFile, err := os.CreateTemp("", "fastfileviewer-raw-preview-*.png")
	if err != nil {
		return nil, fmt.Errorf("建立 RAW 預覽檔失敗: %w", err)
	}
	outputPath := outputFile.Name()
	_ = outputFile.Close()
	defer os.Remove(outputPath)
	command := execCommandContext(operationCtx, "/usr/bin/sips", "-s", "format", "png", sourcePath, "--out", outputPath)
	if output, err := command.CombinedOutput(); err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("macOS 無法解碼 RAW %s: %s", entry.Name, message)
	}
	data, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("讀取 RAW 預覽失敗: %w", err)
	}
	if int64(len(data)) > maxImageBytes {
		return nil, fmt.Errorf("RAW 預覽超過大小上限 %d MB", maxImageBytes/1024/1024)
	}
	return data, nil
}

func exifValue(metadata *exif.Exif, field exif.FieldName) string {
	tag, err := metadata.Get(field)
	if err != nil || tag == nil {
		return ""
	}
	if value, err := tag.StringVal(); err == nil {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(tag.String())
}

func formatGPS(metadata *exif.Exif) string {
	latitude := exifValue(metadata, exif.GPSLatitude)
	longitude := exifValue(metadata, exif.GPSLongitude)
	if latitude == "" || longitude == "" {
		return ""
	}
	latitudeRef := exifValue(metadata, exif.GPSLatitudeRef)
	longitudeRef := exifValue(metadata, exif.GPSLongitudeRef)
	if latitudeRef != "" {
		latitude += " " + latitudeRef
	}
	if longitudeRef != "" {
		longitude += " " + longitudeRef
	}
	return latitude + ", " + longitude
}

// GetMediaMetadata 使用 ffprobe 讀取容器、視訊與音訊串流資訊。
func (s *MediaService) GetMediaMetadata(entry ImageEntry) (MediaMetadata, error) {
	if entry.Kind != "video" && entry.Kind != "audio" {
		return MediaMetadata{}, fmt.Errorf("不是影音檔案: %s", entry.Name)
	}
	operationCtx := context.Background()
	sourcePath := entry.Path
	cleanup := func() {}
	if entry.Source == "archive" {
		prepared, err := s.seekableMediaPath(operationCtx, entry)
		if err != nil {
			return MediaMetadata{}, err
		}
		sourcePath = prepared
		cleanup = func() { _ = s.ReleasePlaybackCache(entry.Path) }
	}
	defer cleanup()
	ffprobePath, err := findFFprobeExecutable()
	if err != nil {
		return MediaMetadata{}, err
	}
	command := execCommandContext(operationCtx, ffprobePath,
		"-v", "error", "-print_format", "json",
		"-show_entries", "format=format_name,duration,bit_rate:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,sample_rate,channels,channel_layout",
		sourcePath,
	)
	payload, err := command.Output()
	if err != nil {
		return MediaMetadata{}, fmt.Errorf("讀取影音資訊失敗: %w", err)
	}
	return parseMediaMetadata(payload)
}

// execCommandContext 以函式包裝 exec.CommandContext，方便單元測試替換。
var execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, name, args...)
}

func parseMediaMetadata(payload []byte) (MediaMetadata, error) {
	var probe struct {
		Format struct {
			FormatName string `json:"format_name"`
			Duration   string `json:"duration"`
			BitRate    string `json:"bit_rate"`
		} `json:"format"`
		Streams []struct {
			CodecType     string `json:"codec_type"`
			CodecName     string `json:"codec_name"`
			Width         int    `json:"width"`
			Height        int    `json:"height"`
			FrameRate     string `json:"avg_frame_rate"`
			PixelFormat   string `json:"pix_fmt"`
			SampleRate    string `json:"sample_rate"`
			Channels      int    `json:"channels"`
			ChannelLayout string `json:"channel_layout"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(payload, &probe); err != nil {
		return MediaMetadata{}, fmt.Errorf("解析影音資訊失敗: %w", err)
	}
	metadata := MediaMetadata{Format: probe.Format.FormatName, Duration: formatDuration(probe.Format.Duration), BitRate: formatBitRate(probe.Format.BitRate)}
	for _, stream := range probe.Streams {
		if stream.CodecType == "video" && metadata.VideoCodec == "" {
			metadata.VideoCodec = stream.CodecName
			metadata.Width = stream.Width
			metadata.Height = stream.Height
			metadata.FrameRate = formatFrameRate(stream.FrameRate)
			metadata.PixelFormat = stream.PixelFormat
		}
		if stream.CodecType == "audio" && metadata.AudioCodec == "" {
			metadata.AudioCodec = stream.CodecName
			metadata.SampleRate = stream.SampleRate
			metadata.Channels = stream.Channels
			metadata.ChannelLayout = stream.ChannelLayout
		}
	}
	return metadata, nil
}

func formatDuration(value string) string {
	seconds, err := strconv.ParseFloat(value, 64)
	if err != nil || seconds < 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return ""
	}
	hours := int(seconds) / 3600
	minutes := (int(seconds) % 3600) / 60
	remaining := seconds - float64(hours*3600+minutes*60)
	if hours > 0 {
		return fmt.Sprintf("%d:%02d:%05.2f", hours, minutes, remaining)
	}
	return fmt.Sprintf("%02d:%05.2f", minutes, remaining)
}

func formatBitRate(value string) string {
	bits, err := strconv.ParseFloat(value, 64)
	if err != nil || bits <= 0 {
		return ""
	}
	if bits >= 1_000_000 {
		return fmt.Sprintf("%.2f Mbps", bits/1_000_000)
	}
	return fmt.Sprintf("%.0f kbps", bits/1_000)
}

func formatFrameRate(value string) string {
	parts := strings.SplitN(value, "/", 2)
	if len(parts) != 2 {
		return value
	}
	numerator, err1 := strconv.ParseFloat(parts[0], 64)
	denominator, err2 := strconv.ParseFloat(parts[1], 64)
	if err1 != nil || err2 != nil || denominator == 0 {
		return ""
	}
	return fmt.Sprintf("%.2f fps", numerator/denominator)
}
