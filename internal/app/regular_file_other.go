//go:build !(aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris)

package app

import "os"

func openRootFileWithoutBlocking(root *os.Root, path string) (*os.File, error) {
	return root.Open(path)
}

func openFileWithoutBlocking(path string) (*os.File, error) {
	return os.Open(path)
}
