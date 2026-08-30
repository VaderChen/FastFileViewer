package app

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestParseMediaMetadata(t *testing.T) {
	payload := []byte(`{"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"65.500000","bit_rate":"2500000"},"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"avg_frame_rate":"30000/1001","pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac","sample_rate":"48000","channels":2,"channel_layout":"stereo"}]}`)
	metadata, err := parseMediaMetadata(payload)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Format == "" || metadata.Duration != "01:05.50" || metadata.BitRate != "2.50 Mbps" {
		t.Fatalf("unexpected container metadata: %#v", metadata)
	}
	if metadata.Width != 1920 || metadata.Height != 1080 || metadata.VideoCodec != "h264" || metadata.FrameRate != "29.97 fps" {
		t.Fatalf("unexpected video metadata: %#v", metadata)
	}
	if metadata.AudioCodec != "aac" || metadata.SampleRate != "48000" || metadata.Channels != 2 || metadata.ChannelLayout != "stereo" {
		t.Fatalf("unexpected audio metadata: %#v", metadata)
	}
}

func TestGetImageMetadataReturnsDimensionsWithoutExif(t *testing.T) {
	imagePath := filepath.Join(t.TempDir(), "sample.png")
	var encoded bytes.Buffer
	sample := image.NewRGBA(image.Rect(0, 0, 3, 2))
	sample.Set(1, 1, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&encoded, sample); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(imagePath, encoded.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(imagePath)
	if err != nil {
		t.Fatal(err)
	}
	entry := buildFileImageEntry(imagePath, info.Size())
	metadata, err := New().Library.GetImageMetadata(entry)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Width != 3 || metadata.Height != 2 {
		t.Fatalf("unexpected image dimensions: %#v", metadata)
	}
}
