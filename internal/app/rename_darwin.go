package app

import (
	"golang.org/x/sys/unix"
	"os"
)

func renameNoReplace(sourcePath, targetPath string) error {
	if err := unix.RenamexNp(sourcePath, targetPath, unix.RENAME_EXCL); err != nil {
		return &os.LinkError{Op: "rename", Old: sourcePath, New: targetPath, Err: err}
	}
	return nil
}
