package updater

import (
	"strconv"
	"strings"
)

func systemVersionAtLeast(current, minimum string) bool {
	parse := func(value string) ([]int, bool) {
		parts := strings.Split(value, ".")
		if len(parts) > 3 || len(parts) == 0 {
			return nil, false
		}
		result := make([]int, 3)
		for i, part := range parts {
			n, err := strconv.Atoi(part)
			if err != nil || n < 0 {
				return nil, false
			}
			result[i] = n
		}
		return result, true
	}
	a, okA := parse(current)
	b, okB := parse(minimum)
	if !okA || !okB {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return true
}
