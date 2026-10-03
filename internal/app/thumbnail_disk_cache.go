package app

import (
	"container/list"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const maxThumbnailDiskBytes int64 = 256 * 1024 * 1024

type thumbnailDiskEntry struct {
	path string
	size int64
}

// Each write enforces both limits. Directory enumeration happens only on initialization.
type thumbnailDiskCache struct {
	mu        sync.Mutex
	directory string
	entries   map[string]*list.Element
	lru       list.List
	bytes     int64
}

func (c *thumbnailDiskCache) initialize(directory string) error {
	if c.entries != nil && c.directory == directory {
		return nil
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	files, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	type candidate struct {
		path string
		info os.FileInfo
	}
	candidates := make([]candidate, 0, len(files))
	for _, file := range files {
		if strings.HasPrefix(file.Name(), "._") || filepath.Ext(file.Name()) != ".png" {
			continue
		}
		info, err := file.Info()
		if err == nil && info.Mode().IsRegular() {
			candidates = append(candidates, candidate{filepath.Join(directory, file.Name()), info})
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].info.ModTime().Before(candidates[j].info.ModTime()) })
	c.directory = directory
	c.entries = make(map[string]*list.Element)
	c.lru.Init()
	c.bytes = 0
	for _, file := range candidates {
		c.add(file.path, file.info.Size())
	}
	return c.trim()
}

func (c *thumbnailDiskCache) forget(path string) {
	if element := c.entries[path]; element != nil {
		c.bytes -= element.Value.(thumbnailDiskEntry).size
		c.lru.Remove(element)
		delete(c.entries, path)
	}
}

func (c *thumbnailDiskCache) add(path string, size int64) {
	c.forget(path)
	c.entries[path] = c.lru.PushBack(thumbnailDiskEntry{path, size})
	c.bytes += size
}

func (c *thumbnailDiskCache) trim() error {
	for len(c.entries) > maxThumbnailCacheFiles || c.bytes > maxThumbnailDiskBytes {
		entry := c.lru.Front().Value.(thumbnailDiskEntry)
		if err := os.Remove(entry.path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		c.forget(entry.path)
	}
	return nil
}

func (c *thumbnailDiskCache) read(path string) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.initialize(filepath.Dir(path)); err != nil {
		return nil, err
	}
	data, err := readThumbnailCache(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.forget(path)
		}
		return nil, err
	}
	c.add(path, int64(len(data)))
	if err := c.trim(); err != nil {
		return nil, err
	}
	return data, nil
}

func (c *thumbnailDiskCache) store(path string, data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.initialize(filepath.Dir(path)); err != nil {
		return err
	}
	if err := writeThumbnailCache(path, data); err != nil {
		return err
	}
	c.add(path, int64(len(data)))
	if err := c.trim(); err != nil {
		_ = os.Remove(path)
		c.forget(path)
		return err
	}
	return nil
}
