package app

import (
	"errors"
	"os"
)

var errNotRegularFile = errors.New("不是一般檔案")

func openRegularFile(path string) (*os.File, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, &os.PathError{Op: "open", Path: path, Err: errNotRegularFile}
	}
	// Recheck the opened descriptor: a file may be replaced after Stat.
	// Unix uses O_NONBLOCK so replacement with a FIFO cannot block in Open.
	file, err := openFileWithoutBlocking(path)
	if err != nil {
		return nil, err
	}
	info, err = file.Stat()
	if err == nil && !info.Mode().IsRegular() {
		err = &os.PathError{Op: "open", Path: path, Err: errNotRegularFile}
	}
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return file, nil
}
