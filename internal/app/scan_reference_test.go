package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Original scan retained to compare filtering, ordering and allocations.
func (a *App) referenceScanDirectory(directoryPath string, enabledImageExtensions []string, enabledDocumentExtensions []string, enabledMediaExtensions []string, operationID int64) (DirectoryScanResult, error) {
	operationCtx := a.operationContext(operationID)
	if err := checkOperation(operationCtx); err != nil {
		return DirectoryScanResult{}, err
	}
	directoryPath = strings.TrimSpace(directoryPath)
	if directoryPath == "" {
		return DirectoryScanResult{}, errors.New("請先選擇目錄")
	}
	imageExtensionFilter := newExtensionFilter(enabledImageExtensions, supportedImageExtensions)
	// Match the current supported-format policy in both scan implementations.
	allDocumentExtensions := append(append([]string{}, supportedDocumentExtensions...), supportedCodeExtensions...)
	documentExtensionFilter := newExtensionFilter(enabledDocumentExtensions, allDocumentExtensions)
	mediaExtensionFilter := newExtensionFilter(enabledMediaExtensions, supportedMediaExtensions)

	absPath, err := filepath.Abs(directoryPath)
	if err != nil {
		return DirectoryScanResult{}, err
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return DirectoryScanResult{}, err
	}
	if !info.IsDir() {
		return DirectoryScanResult{}, fmt.Errorf("不是有效目錄: %s", absPath)
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		return DirectoryScanResult{}, err
	}

	node := &LibraryNode{
		ID:       nodeID(absPath),
		Name:     displayName(absPath),
		Path:     absPath,
		Kind:     "directory",
		Scanned:  true,
		Images:   []ImageEntry{},
		Children: []LibraryNode{},
	}
	warnings := []string{}

	for _, entry := range entries {
		if err := checkOperation(operationCtx); err != nil {
			return DirectoryScanResult{}, err
		}
		if shouldIgnoreEntryName(entry.Name()) {
			continue
		}
		childPath := filepath.Join(absPath, entry.Name())
		if entry.IsDir() {
			node.Children = append(node.Children, buildDirectoryNode(childPath, false))
			continue
		}

		extension := normalizedExtension(childPath)
		isContent := isEnabledExtension(extension, imageExtensionFilter) || isEnabledExtension(extension, documentExtensionFilter) || isEnabledExtension(extension, mediaExtensionFilter)
		if !isContent && !isSupportedArchive(extension) {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			// 檔案連結使用目標大小；不遞迴目錄連結，也不列出 FIFO／裝置。
			info, err = os.Stat(childPath)
		}
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		if isContent {
			image := buildFileImageEntryWithExtension(childPath, info.Size(), extension)
			node.Images = append(node.Images, image)
			a.rememberImage(image)
			continue
		}
		if isSupportedArchive(extension) {
			archiveNode, err := a.scanArchiveNode(operationCtx, childPath, imageExtensionFilter, documentExtensionFilter, mediaExtensionFilter)
			if errors.Is(err, errOperationCancelled) {
				return DirectoryScanResult{}, err
			}
			if err == nil && (len(archiveNode.Images) > 0 || len(archiveNode.Children) > 0) {
				node.Children = append(node.Children, archiveNode)
			} else if err != nil {
				warnings = append(warnings, fmt.Sprintf("%s: %v", filepath.Base(childPath), err))
			}
		}
	}

	sort.SliceStable(node.Images, func(i, j int) bool {
		return lessLowercaseName(node.Images[i].Name, node.Images[j].Name)
	})
	sort.SliceStable(node.Children, func(i, j int) bool {
		if node.Children[i].Kind != node.Children[j].Kind {
			return kindRank(node.Children[i].Kind) < kindRank(node.Children[j].Kind)
		}
		return lessLowercaseName(node.Children[i].Name, node.Children[j].Name)
	})

	return DirectoryScanResult{
		RootPath: absPath,
		Node:     node,
		Warnings: warnings,
	}, nil
}
