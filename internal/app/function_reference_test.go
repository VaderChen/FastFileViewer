package app

import (
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Independent pre-optimization algorithms for byte-for-byte regression checks.
func referenceNormalizedExtension(filePath string) string {
	if special := normalizedSpecialFileName(filepath.Base(filePath)); special != "" {
		return special
	}
	lower := strings.ToLower(filePath)
	if strings.HasSuffix(lower, ".tar.gz") {
		return ".tar.gz"
	}
	return strings.ToLower(filepath.Ext(filePath))
}

func referenceNormalizeLineEndings(text string) string {
	return strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
}

func referenceDecodeUTF16Document(data []byte) (string, bool) {
	if !hasUTF16ByteOrderMark(data) || len(data)%2 != 0 {
		return "", false
	}
	var byteOrder binary.ByteOrder = binary.LittleEndian
	if data[0] == 0xfe {
		byteOrder = binary.BigEndian
	}
	units := make([]uint16, 0, (len(data)-2)/2)
	for index := 2; index+1 < len(data); index += 2 {
		units = append(units, byteOrder.Uint16(data[index:index+2]))
	}
	return string(utf16.Decode(units)), true
}

func referenceNormalizeArchiveEntryName(entryName string) string {
	// Valid UTF-8 is already decoded; guessing legacy encodings can corrupt it.
	if utf8.ValidString(entryName) && !strings.ContainsRune(entryName, utf8.RuneError) {
		return entryName
	}
	raw := []byte(entryName)
	candidates := []string{}
	if utf8.Valid(raw) {
		candidates = append(candidates, string(raw))
	}
	candidates = referenceAppendDecodedCandidate(candidates, raw, simplifiedchinese.GBK)
	candidates = referenceAppendDecodedCandidate(candidates, raw, traditionalchinese.Big5)
	candidates = referenceAppendDecodedCandidate(candidates, raw, charmap.CodePage437)
	candidates = referenceAppendDecodedCandidate(candidates, raw, charmap.Windows1252)

	best := entryName
	bestScore := scoreEntryName(entryName)
	seen := map[string]bool{entryName: true}
	for _, candidate := range candidates {
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true
		score := scoreEntryName(candidate)
		if score > bestScore {
			best = candidate
			bestScore = score
		}
	}
	return best
}

func referenceAppendDecodedCandidate(candidates []string, raw []byte, enc encoding.Encoding) []string {
	decoded, err := enc.NewDecoder().String(string(raw))
	if err != nil {
		return candidates
	}
	return append(candidates, decoded)
}

func referenceDecodeDocumentText(data []byte) string {
	if decoded, ok := referenceDecodeUTF16Document(data); ok {
		return referenceNormalizeLineEndings(decoded)
	}
	if utf8.Valid(data) {
		return referenceNormalizeLineEndings(strings.TrimPrefix(string(data), "\ufeff"))
	}
	type encodingCandidate struct {
		encoding encoding.Encoding
		bias     int
	}
	bestText := string(data)
	bestScore := scoreDecodedDocument(bestText) - 100
	for _, candidate := range []encodingCandidate{
		{encoding: simplifiedchinese.GB18030, bias: 3},
		{encoding: traditionalchinese.Big5, bias: 2},
		{encoding: japanese.ShiftJIS},
		{encoding: charmap.Windows1252, bias: -5},
	} {
		decoded, err := candidate.encoding.NewDecoder().Bytes(data)
		if err != nil || !utf8.Valid(decoded) {
			continue
		}
		text := string(decoded)
		score := scoreDecodedDocument(text) + candidate.bias
		if score > bestScore {
			bestText = text
			bestScore = score
		}
	}
	return referenceNormalizeLineEndings(bestText)
}

func referenceAddArchiveImageToNode(root *LibraryNode, image ImageEntry, childIndexes map[string]map[string]int) {
	innerDirectory := path.Dir(image.InnerPath)
	if innerDirectory == "." || innerDirectory == "" {
		root.Images = append(root.Images, image)
		return
	}

	current := root
	accumulated := ""
	for _, part := range strings.Split(innerDirectory, "/") {
		if part == "" || part == "." {
			continue
		}
		if accumulated == "" {
			accumulated = part
		} else {
			accumulated += "/" + part
		}
		virtualPath := root.Path + "::" + accumulated
		indexes := childIndexes[current.Path]
		if indexes == nil {
			indexes = make(map[string]int)
			childIndexes[current.Path] = indexes
		}
		// Store slice indices, not pointers that append may invalidate.
		childIndex, exists := indexes[part]
		if !exists {
			current.Children = append(current.Children, LibraryNode{
				ID:       hashID("archive-dir", virtualPath),
				Name:     part,
				Path:     virtualPath,
				Kind:     "directory",
				Scanned:  true,
				Images:   []ImageEntry{},
				Children: []LibraryNode{},
			})
			childIndex = len(current.Children) - 1
			indexes[part] = childIndex
		}
		current = &current.Children[childIndex]
	}
	current.Images = append(current.Images, image)
}

func referenceHashID(parts ...string) string {
	hash := sha1.New()
	for _, part := range parts {
		_, _ = hash.Write([]byte(part))
		_, _ = hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}
