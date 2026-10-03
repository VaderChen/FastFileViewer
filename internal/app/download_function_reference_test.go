package app

import (
	"html"
	"net/url"
	"path/filepath"
	"strings"
)

func referenceParseHLSAttributes(value string) map[string]string {
	attributes := make(map[string]string)
	start := 0
	quoted := false
	parts := make([]string, 0, 8)
	for index, character := range value {
		if character == '"' {
			quoted = !quoted
		}
		if character == ',' && !quoted {
			parts = append(parts, value[start:index])
			start = index + 1
		}
	}
	parts = append(parts, value[start:])
	for _, part := range parts {
		key, attributeValue, found := strings.Cut(part, "=")
		if !found {
			continue
		}
		attributes[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(attributeValue), "\"")
	}
	return attributes
}

func referenceExtractEmbeddedHLSURLs(content string, baseURL *url.URL) []string {
	normalized := html.UnescapeString(content)
	normalized = strings.NewReplacer(
		`\/`, `/`,
		`\u002F`, `/`,
		`\u002f`, `/`,
		`\u003A`, `:`,
		`\u003a`, `:`,
		`\x2F`, `/`,
		`\x2f`, `/`,
		`\x3A`, `:`,
		`\x3a`, `:`,
	).Replace(normalized)

	rawCandidates := absoluteHLSURLPattern.FindAllString(normalized, maxEmbeddedHLSCandidates)
	for _, match := range quotedHLSURLPattern.FindAllStringSubmatch(normalized, maxEmbeddedHLSCandidates) {
		if len(match) > 1 {
			rawCandidates = append(rawCandidates, match[1])
		}
	}

	result := make([]string, 0, minInt(len(rawCandidates), maxEmbeddedHLSCandidates))
	seen := make(map[string]struct{}, len(rawCandidates))
	for _, candidate := range rawCandidates {
		candidate = strings.TrimSpace(strings.Trim(candidate, `"'`))
		if strings.HasPrefix(candidate, "//") {
			candidate = baseURL.Scheme + ":" + candidate
		}
		parsedCandidate, err := url.Parse(candidate)
		if err != nil {
			continue
		}
		resolved := baseURL.ResolveReference(parsedCandidate)
		if (resolved.Scheme != "http" && resolved.Scheme != "https") || resolved.Hostname() == "" || resolved.User != nil || !strings.EqualFold(filepath.Ext(resolved.Path), ".m3u8") {
			continue
		}
		value := resolved.String()
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
		if len(result) >= maxEmbeddedHLSCandidates {
			break
		}
	}
	return result
}
