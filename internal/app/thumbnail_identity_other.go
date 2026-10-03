//go:build !darwin

package app

import "os"

// Other platforms retain the portable source size and modification-time checks.
func thumbnailFileIdentity(info os.FileInfo) string { return "" }
