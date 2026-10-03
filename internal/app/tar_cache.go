package app

import (
	"archive/tar"
	"context"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const maxCachedTARs = 2
const maxCachedTARBytes int64 = 256 * 1024 * 1024
const maxCachedTAREntries = 20000

type tarOffset struct{ offset, size int64 }
type cachedTAR struct {
	info     os.FileInfo
	file     *os.File
	index    map[string]tarOffset
	users    int
	cached   bool
	lastUsed uint64
}

type tarIndexCache struct {
	liveFiles int
	mu        archiveCacheMutex
	items     map[string]*cachedTAR
	clock     uint64
}

var archiveTARs = &tarIndexCache{items: make(map[string]*cachedTAR)}

// 小型 TAR/TGZ 只展開一次至私有暫存檔，利用 offset 直接讀取內容。
// 不將封存路徑寫到檔案系統；容量、項目數超標時回到串流讀取。
func (cache *tarIndexCache) open(ctx context.Context, entry ImageEntry) (io.ReadCloser, error) {
	if err := checkOperation(ctx); err != nil {
		return nil, err
	}
	key, err := filepath.Abs(entry.ArchivePath)
	if err != nil {
		return nil, err
	}
	if err := cache.mu.lockContext(ctx); err != nil {
		return nil, err
	}
	reader, err := cache.openLocked(ctx, key, entry.InnerPath)
	cache.mu.Unlock()
	if reader != nil || err != nil {
		return reader, err
	}
	return openTarEntryReaderUncached(ctx, entry)
}

func (cache *tarIndexCache) openLocked(ctx context.Context, key, name string) (io.ReadCloser, error) {
	info, err := os.Stat(key)
	if err != nil {
		return nil, err
	}
	item := cache.items[key]
	if item != nil && !sameArchiveVersion(info, item.info) {
		cache.remove(key)
		item = nil
	}
	if item == nil {
		// 先淘汰再建立，避免暫存磁碟多占一份。使用中的 reader 不可關閉。
		for len(cache.items) >= maxCachedTARs {
			oldestKey := ""
			var oldest *cachedTAR
			for candidateKey, candidate := range cache.items {
				if candidate.users == 0 && (oldest == nil || candidate.lastUsed < oldest.lastUsed) {
					oldestKey, oldest = candidateKey, candidate
				}
			}
			if oldest == nil {
				return nil, nil
			}
			cache.remove(oldestKey)
		}
		if cache.liveFiles >= maxCachedTARs {
			return nil, nil
		}
		item, err = buildTARIndex(ctx, key, info)
		if err != nil {
			return nil, err
		}
		if item.file != nil {
			cache.liveFiles++
		}
		item.cached = true
		cache.items[key] = item
	}
	cache.clock++
	item.lastUsed = cache.clock
	if err := checkOperation(ctx); err != nil {
		return nil, err
	}
	offset, ok := item.index[name]
	// 未快取的超大檔案、稀疏檔案或不存在的項目，沿用原讀取器判定。
	if item.file == nil || !ok {
		return nil, nil
	}
	item.users++
	return &archiveEntryReadCloser{Reader: &contextReader{ctx: ctx, reader: io.NewSectionReader(item.file, offset.offset, offset.size)}, close: func() error {
		cache.mu.Lock()
		defer cache.mu.Unlock()
		item.users--
		if item.users == 0 && !item.cached {
			cache.closeItem(item)
		}
		return nil
	}}, nil
}

func isReadableTARHeader(header *tar.Header) bool {
	return header.Typeflag == tar.TypeReg || header.Typeflag == tar.TypeRegA || header.Typeflag == tar.TypeGNUSparse
}

func buildTARIndex(ctx context.Context, name string, info os.FileInfo) (*cachedTAR, error) {
	item := &cachedTAR{info: info}
	if info.Size() > maxCachedTARBytes {
		return item, nil
	}
	sourceFile, err := openRegularFile(name)
	if err != nil {
		return nil, err
	}
	defer sourceFile.Close()
	item.info, err = sourceFile.Stat()
	if err != nil {
		return nil, err
	}
	if item.info.Size() > maxCachedTARBytes {
		return item, nil
	}
	source, closeSource, err := tarSourceReader(sourceFile, name)
	if err != nil {
		return nil, err
	}
	if closeSource != nil {
		defer closeSource()
	}
	spool, err := os.CreateTemp("", "fastfileviewer-tar-*")
	if err != nil {
		return item, nil
	} // 磁碟無法快取時仍能讀取原始檔。
	keep := false
	defer func() {
		if !keep {
			_ = spool.Close()
			_ = os.Remove(spool.Name())
		}
	}()
	input := &countingTARReader{reader: io.TeeReader(io.LimitReader(&contextReader{ctx: ctx, reader: source}, maxCachedTARBytes+1), spool)}
	reader := tar.NewReader(input)
	index := make(map[string]tarOffset)
	seen := make(map[string]bool)
	for {
		header, err := reader.Next()
		if input.bytes > maxCachedTARBytes || len(seen) >= maxCachedTAREntries {
			return item, nil // 記住這個版本不可快取，避免每次切圖重試。
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if cancelErr := checkOperation(ctx); cancelErr != nil {
				return nil, cancelErr
			}
			return item, nil // 格式或磁碟錯誤由原讀取器重新處理。
		}
		if !isReadableTARHeader(header) {
			continue
		}
		entryName := strings.Trim(path.Clean(normalizeArchiveEntryName(header.Name)), "/")
		if seen[entryName] {
			continue
		}
		seen[entryName] = true
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA {
			continue
		}
		sparse := false
		for key := range header.PAXRecords {
			if strings.HasPrefix(key, "GNU.sparse.") {
				sparse = true
				break
			}
		}
		if !sparse {
			index[entryName] = tarOffset{offset: input.bytes, size: header.Size}
		}
	}
	if err := checkOperation(ctx); err != nil {
		return nil, err
	}
	// Only publish a snapshot if both the open file and its path still match.
	latest, err := sourceFile.Stat()
	if err != nil {
		return nil, err
	}
	current, err := os.Stat(name)
	if err != nil {
		return nil, err
	}
	if !sameArchiveVersion(latest, item.info) || !sameArchiveVersion(current, item.info) {
		return nil, errors.New("封存檔在讀取期間已變更，請重新開啟")
	}
	item.file, item.index = spool, index
	keep = true
	return item, nil
}

type countingTARReader struct {
	reader io.Reader
	bytes  int64
}

func (reader *countingTARReader) Read(buffer []byte) (int, error) {
	n, err := reader.reader.Read(buffer)
	reader.bytes += int64(n)
	return n, err
}

func (cache *tarIndexCache) closeItem(item *cachedTAR) {
	if item.file != nil {
		_ = item.file.Close()
		_ = os.Remove(item.file.Name())
		cache.liveFiles--
	}
}

func (cache *tarIndexCache) remove(key string) {
	item := cache.items[key]
	delete(cache.items, key)
	item.cached = false
	if item.users == 0 {
		cache.closeItem(item)
	}
}

func (cache *tarIndexCache) clear() {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	for key := range cache.items {
		cache.remove(key)
	}
}
