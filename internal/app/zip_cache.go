package app

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
)

const maxCachedZIPs = 4
const maxCachedZIPEntries = 20000
const maxCachedZIPMetadataBytes = 8 * 1024 * 1024

type cachedZIP struct {
	reader   *zipFileReader
	info     os.FileInfo
	index    map[string]*zip.File
	users    int
	cached   bool
	lastUsed uint64
}

type zipIndexCache struct {
	mu    archiveCacheMutex
	items map[string]*cachedZIP
	clock uint64
}

var archiveZIPs = &zipIndexCache{items: make(map[string]*cachedZIP)}

// 同一個 ZIP 共用中央目錄與名稱索引。淘汰時等待使用中的 reader 關閉，
// 因此切換圖庫或替換壓縮檔不會中斷進行中的讀取。
func (cache *zipIndexCache) open(ctx context.Context, entry ImageEntry) (io.ReadCloser, error) {
	if err := checkOperation(ctx); err != nil {
		return nil, err
	}
	archivePath, err := filepath.Abs(entry.ArchivePath)
	if err != nil {
		return nil, err
	}
	if err := cache.mu.lockContext(ctx); err != nil {
		return nil, err
	}
	defer cache.mu.Unlock()
	info, err := os.Stat(archivePath)
	if err != nil {
		return nil, err
	}
	item := cache.items[archivePath]
	if item != nil && !sameArchiveVersion(info, item.info) {
		cache.remove(archivePath)
		item = nil
	}
	if item == nil {
		reader, err := openZIPFile(archivePath)
		if err != nil {
			return nil, err
		}
		item = &cachedZIP{reader: reader, info: reader.info, index: make(map[string]*zip.File)}
		metadataBytes := 0
		for _, file := range reader.File {
			metadataBytes += 256 + len(file.Name) + len(file.Extra) + len(file.Comment)
		}
		cacheable := len(reader.File) <= maxCachedZIPEntries && metadataBytes <= maxCachedZIPMetadataBytes
		for _, file := range reader.File {
			if err := checkOperation(ctx); err != nil {
				_ = reader.Close()
				return nil, err
			}
			if !file.Mode().IsRegular() {
				continue
			}
			name := strings.Trim(path.Clean(normalizeZipEntryName(file)), "/")
			// 保留既有行為：同名時取第一個項目。
			if _, exists := item.index[name]; !exists && (cacheable || name == entry.InnerPath) {
				item.index[name] = file
			}
		}
		if cacheable {
			for len(cache.items) >= maxCachedZIPs {
				oldestPath := ""
				var oldest *cachedZIP
				for key, candidate := range cache.items {
					if oldest == nil || candidate.lastUsed < oldest.lastUsed {
						oldestPath, oldest = key, candidate
					}
				}
				cache.remove(oldestPath)
			}
			item.cached = true
			cache.items[archivePath] = item
		}
	}
	cache.clock++
	item.lastUsed = cache.clock
	file := item.index[entry.InnerPath]
	if file == nil {
		if !item.cached {
			_ = item.reader.Close()
		}
		return nil, fmt.Errorf("壓縮檔內找不到內容: %s", entry.InnerPath)
	}
	opened, err := file.Open()
	if err != nil {
		if !item.cached {
			_ = item.reader.Close()
		}
		return nil, err
	}
	item.users++
	return &archiveEntryReadCloser{Reader: &contextReader{ctx: ctx, reader: opened}, close: func() error {
		err := opened.Close()
		cache.mu.Lock()
		defer cache.mu.Unlock()
		item.users--
		if item.users == 0 && !item.cached {
			_ = item.reader.Close()
		}
		return err
	}}, nil
}

// 呼叫端必須持有 mu。
func (cache *zipIndexCache) remove(key string) {
	item := cache.items[key]
	delete(cache.items, key)
	item.cached = false
	if item.users == 0 {
		_ = item.reader.Close()
	}
}

func (cache *zipIndexCache) clear() {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	for key := range cache.items {
		cache.remove(key)
	}
}

type archiveEntryReadCloser struct {
	io.Reader
	once  sync.Once
	close func() error
	err   error
}

func (reader *archiveEntryReadCloser) Close() error {
	reader.once.Do(func() { reader.err = reader.close() })
	return reader.err
}

// 建立 TAR 索引時可能讀取整個壓縮檔；等待其他讀取器的操作仍須能取消。
// Close/clear 維持一般 Lock 介面，open 則使用帶 context 的等待。
type archiveCacheMutex struct {
	once  sync.Once
	token chan struct{}
}

func (mu *archiveCacheMutex) init() {
	mu.once.Do(func() { mu.token = make(chan struct{}, 1) })
}

func (mu *archiveCacheMutex) Lock() {
	mu.init()
	mu.token <- struct{}{}
}

func (mu *archiveCacheMutex) Unlock() {
	<-mu.token
}

func (mu *archiveCacheMutex) lockContext(ctx context.Context) error {
	mu.init()
	select {
	case mu.token <- struct{}{}:
		if err := checkOperation(ctx); err != nil {
			mu.Unlock()
			return err
		}
		return nil
	case <-ctx.Done():
		return errOperationCancelled
	}
}

// 同一路徑原地更新且保留 mtime 時，仍須使封存內容與名稱索引一起失效。
func sameArchiveVersion(current, previous os.FileInfo) bool {
	return os.SameFile(current, previous) &&
		current.Size() == previous.Size() &&
		current.ModTime().Equal(previous.ModTime()) &&
		thumbnailFileIdentity(current) == thumbnailFileIdentity(previous)
}

// zip.OpenReader 直接 os.Open；使用一般檔案 FD 防止路徑被換成 FIFO 時阻塞。
type zipFileReader struct {
	*zip.Reader
	file *os.File
	info os.FileInfo
}

func openZIPFile(name string) (*zipFileReader, error) {
	file, err := openRegularFile(name)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	reader, err := zip.NewReader(file, info.Size())
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &zipFileReader{Reader: reader, file: file, info: info}, nil
}

func (reader *zipFileReader) Close() error { return reader.file.Close() }
