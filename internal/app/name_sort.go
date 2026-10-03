package app

import (
	"unicode"
	"unicode/utf8"
)

// lessLowercaseName preserves strings.ToLower(left) < strings.ToLower(right)
// without constructing both lowercase strings for every sort comparison.
// Lowercase rune order equals UTF-8 byte order, including the replacement rune
// used by strings.ToLower for invalid UTF-8. Equal names remain stable.
func lessLowercaseName(left, right string) bool {
	for len(left) > 0 && len(right) > 0 {
		// Most filename prefixes are ASCII. Keep that comparison in this loop
		// so a shared prefix does not require decoding each character.
		leftByte, rightByte := left[0], right[0]
		if leftByte < utf8.RuneSelf && rightByte < utf8.RuneSelf {
			if leftByte >= 'A' && leftByte <= 'Z' {
				leftByte += 'a' - 'A'
			}
			if rightByte >= 'A' && rightByte <= 'Z' {
				rightByte += 'a' - 'A'
			}
			if leftByte != rightByte {
				return leftByte < rightByte
			}
			left, right = left[1:], right[1:]
			continue
		}
		leftRune, leftWidth := lowercaseNameRune(left)
		rightRune, rightWidth := lowercaseNameRune(right)
		if leftRune != rightRune {
			return leftRune < rightRune
		}
		left = left[leftWidth:]
		right = right[rightWidth:]
	}
	return len(left) < len(right)
}

func lowercaseNameRune(value string) (rune, int) {
	if first := value[0]; first < utf8.RuneSelf {
		if first >= 'A' && first <= 'Z' {
			first += 'a' - 'A'
		}
		return rune(first), 1
	}
	valueRune, width := utf8.DecodeRuneInString(value)
	return unicode.ToLower(valueRune), width
}
