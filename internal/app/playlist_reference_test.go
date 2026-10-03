package app

import (
	"bufio"
	"errors"
	"net/url"
	"strconv"
	"strings"
)

// Original parser retained for parity tests and comparative benchmarks.
func referenceParseHLSPlaylist(content string, baseURL *url.URL) (hlsPlaylist, error) {
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
	var previousRangeURL string
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
			if pendingRange != "" && !strings.Contains(pendingRange, "@") && previousRangeURL != resolved {
				return hlsPlaylist{}, errors.New("implicit HLS byte range requires the previous segment to use the same resource")
			}
			byteRange, nextOffset, err := hlsByteRange(pendingRange, rangeOffset)
			if err != nil {
				return hlsPlaylist{}, err
			}
			if pendingRange != "" {
				rangeOffset = nextOffset
				previousRangeURL = resolved
			} else {
				rangeOffset = 0
				previousRangeURL = ""
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
