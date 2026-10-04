package build

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// This file is overlaid into the pinned Wails CLI at build time. The original
// module cache stays untouched. Run after packaging, immediately before signing:
// macOS can recreate AppleDouble files on ExFAT even after xattr -rc succeeds.
func cleanFFVBundleForSigning(binary string) error {
	macOS := filepath.Dir(binary)
	contents := filepath.Dir(macOS)
	bundle := filepath.Dir(contents)
	if filepath.Base(macOS) != "MacOS" || filepath.Base(contents) != "Contents" || !strings.HasSuffix(bundle, ".app") {
		return fmt.Errorf("unexpected macOS bundle executable: %s", binary)
	}
	return filepath.WalkDir(bundle, func(path string, entry fs.DirEntry, walkErr error) error {
		if errors.Is(walkErr, fs.ErrNotExist) {
			return nil // Removing a sidecar can also remove another metadata entry.
		}
		if walkErr != nil {
			return walkErr
		}
		if !entry.Type().IsRegular() || !strings.HasPrefix(entry.Name(), "._") {
			return nil
		}
		file, err := os.Open(path)
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		var header [8]byte
		_, readErr := io.ReadFull(file, header[:])
		closeErr := file.Close()
		if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
			return readErr
		}
		if closeErr != nil {
			return closeErr
		}
		// Only AppleDouble version 2 metadata; preserve ordinary ._ named files.
		if readErr != nil || header != [8]byte{0, 5, 22, 7, 0, 2, 0, 0} {
			return nil
		}
		err = os.Remove(path)
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	})
}
