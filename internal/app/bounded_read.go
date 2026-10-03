package app

import "io"

const maxReadSizeHint int64 = 1024 * 1024

// readAllWithSizeHint avoids repeated growth for typical cached thumbnails and
// documents. Metadata only suggests capacity: it never controls how many bytes
// are read. Callers still bound their readers and validate the resulting length.
// Ignore larger hints so stale sizes and archive headers cannot eagerly allocate
// the entire permitted input size; large inputs use the standard chunked reader.
func readAllWithSizeHint(reader io.Reader, sizeHint int64) ([]byte, error) {
	if sizeHint <= 0 || sizeHint > maxReadSizeHint {
		return io.ReadAll(reader)
	}
	data := make([]byte, 0, int(sizeHint)+1)
	for len(data) < cap(data) {
		n, err := reader.Read(data[len(data):cap(data)])
		data = data[:len(data)+n]
		if err != nil {
			if err == io.EOF {
				err = nil
			}
			return data, err
		}
	}

	// The source grew beyond its hint. Continue to EOF (including late checksum
	// and cancellation errors) instead of truncating at the metadata size.
	rest, err := io.ReadAll(reader)
	if len(rest) == 0 {
		return data, err
	}
	combined := make([]byte, len(data)+len(rest))
	copy(combined, data)
	copy(combined[len(data):], rest)
	return combined, err
}
