package app

import (
	"fmt"
	"os"
	"syscall"
)

// Inode identity detects replacement; change time also catches edits preserving mtime.
func thumbnailFileIdentity(info os.FileInfo) string {
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		return fmt.Sprintf("%d:%d:%d:%d", stat.Dev, stat.Ino, stat.Ctimespec.Sec, stat.Ctimespec.Nsec)
	}
	return ""
}
