//go:build !darwin

package app

import "syscall"

// The common fallback creates the destination exclusively before removing the source.
func renameNoReplace(sourcePath, targetPath string) error { return syscall.ENOTSUP }
