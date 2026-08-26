package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// FileService 提供改名、移動與垃圾桶操作；檔案異動後會回傳可直接替換清單的項目。
type FileService struct {
	ctx     context.Context
	entries *entryRegistry
}

var renameFile = os.Rename

func newFileService(entries *entryRegistry) *FileService {
	return &FileService{entries: entries}
}

func (s *FileService) Startup(ctx context.Context) { s.ctx = ctx }

// RenameEntry 將單一檔案改名，並拒絕覆寫既有檔案或修改副檔名以外的路徑。
func (s *FileService) RenameEntry(filePath string, newName string) (ImageEntry, error) {
	entry, err := entryByPath(filePath)
	if err != nil {
		return ImageEntry{}, err
	}
	if entry.Source != "file" {
		return ImageEntry{}, errors.New("壓縮檔內的項目不可修改")
	}
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return ImageEntry{}, errors.New("新檔名不可空白")
	}
	if strings.ContainsAny(newName, `/\\`) || newName == "." || newName == ".." {
		return ImageEntry{}, errors.New("新檔名不可包含路徑")
	}
	targetPath := filepath.Join(entry.DirectoryPath, newName)
	if _, statErr := os.Stat(targetPath); statErr == nil {
		return ImageEntry{}, errors.New("目標檔案已存在")
	} else if !os.IsNotExist(statErr) {
		return ImageEntry{}, statErr
	}
	if err := renameFile(entry.Path, targetPath); err != nil {
		return ImageEntry{}, fmt.Errorf("改名失敗: %w", err)
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		return ImageEntry{}, fmt.Errorf("讀取改名後檔案失敗: %w", err)
	}
	replacement := buildFileImageEntry(targetPath, info.Size())
	s.entries.remember(replacement)
	return replacement, nil
}

// TrashEntries 將檔案逐一移入垃圾桶；單項失敗不會中止其餘項目。
func (s *FileService) TrashEntries(filePaths []string) (TrashResult, error) {
	result := TrashResult{RemovedIDs: []string{}, Failed: []FileOperationFailure{}}
	seen := make(map[string]bool)
	seenPaths := make(map[string]bool)
	for _, filePath := range filePaths {
		if seenPaths[filePath] {
			continue
		}
		seenPaths[filePath] = true
		entry, err := entryByPath(filePath)
		if err != nil {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: err.Error()})
			continue
		}
		if entry.Source != "file" {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: "壓縮檔內的項目不可修改"})
			continue
		}
		if seen[entry.ID] {
			continue
		}
		seen[entry.ID] = true
		if err := moveToTrash(entry.Path); err != nil {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: fmt.Sprintf("移到垃圾桶失敗: %v", err)})
			continue
		}
		result.RemovedIDs = append(result.RemovedIDs, entry.ID)
	}
	return result, nil
}

// ConfirmTrashEntries 讓破壞性操作先經過原生確認對話框；文字由前端依目前語系提供。
func (s *FileService) ConfirmTrashEntries(filePaths []string, title string, message string, confirmLabel string, cancelLabel string) (TrashResult, error) {
	if s.ctx == nil {
		return TrashResult{}, errors.New("應用程式尚未完成初始化")
	}
	selection, err := wailsruntime.MessageDialog(s.ctx, wailsruntime.MessageDialogOptions{
		Type:          wailsruntime.QuestionDialog,
		Title:         title,
		Message:       message,
		Buttons:       []string{confirmLabel, cancelLabel},
		DefaultButton: cancelLabel,
		CancelButton:  cancelLabel,
	})
	if err != nil || selection != confirmLabel {
		return TrashResult{RemovedIDs: []string{}, Failed: []FileOperationFailure{}}, err
	}
	return s.TrashEntries(filePaths)
}

// MoveEntries 將檔案逐一移至目標資料夾，跨磁碟區時會退回複製後刪除。
func (s *FileService) MoveEntries(filePaths []string, destination string) (MoveResult, error) {
	result := MoveResult{Moved: []ImageEntry{}, Failed: []FileOperationFailure{}}
	destination = strings.TrimSpace(destination)
	if destination == "" {
		return result, errors.New("移動目的地不可空白")
	}
	info, err := os.Stat(destination)
	if err != nil {
		return result, fmt.Errorf("無法存取移動目的地: %w", err)
	}
	if !info.IsDir() {
		return result, errors.New("移動目的地不是資料夾")
	}
	seen := make(map[string]bool)
	seenPaths := make(map[string]bool)
	for _, filePath := range filePaths {
		if seenPaths[filePath] {
			continue
		}
		seenPaths[filePath] = true
		entry, entryErr := entryByPath(filePath)
		if entryErr != nil {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: entryErr.Error()})
			continue
		}
		if entry.Source != "file" {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: "壓縮檔內的項目不可修改"})
			continue
		}
		if seen[entry.ID] {
			continue
		}
		seen[entry.ID] = true
		targetPath := filepath.Join(destination, entry.Name)
		if _, statErr := os.Stat(targetPath); statErr == nil {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: "目標檔案已存在"})
			continue
		} else if !os.IsNotExist(statErr) {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: statErr.Error()})
			continue
		}
		if err := renameFile(entry.Path, targetPath); err != nil {
			if copyErr := duplicateFile(entry.Path, targetPath); copyErr != nil {
				result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: fmt.Sprintf("移動失敗: %v", err)})
				continue
			}
			if removeErr := os.Remove(entry.Path); removeErr != nil {
				_ = os.Remove(targetPath)
				result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: fmt.Sprintf("移動後清理來源失敗: %v", removeErr)})
				continue
			}
		}
		movedInfo, statErr := os.Stat(targetPath)
		if statErr != nil {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: statErr.Error()})
			continue
		}
		moved := buildFileImageEntry(targetPath, movedInfo.Size())
		s.entries.remember(moved)
		result.Moved = append(result.Moved, moved)
	}
	return result, nil
}

func (s *FileService) SelectMoveDestination(dialogTitle string) (string, error) {
	if s.ctx == nil {
		return "", nil
	}
	return wailsruntime.OpenDirectoryDialog(s.ctx, wailsruntime.OpenDialogOptions{Title: strings.TrimSpace(dialogTitle)})
}

// duplicateFile 會優先建立硬連結，跨磁碟區時才實際複製內容。
func duplicateFile(sourcePath string, targetPath string) error {
	if err := os.Link(sourcePath, targetPath); err == nil {
		return nil
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(target, source); err != nil {
		_ = target.Close()
		_ = os.Remove(targetPath)
		return err
	}
	if err := target.Close(); err != nil {
		_ = os.Remove(targetPath)
		return err
	}
	return nil
}

func moveToTrash(filePath string) error {
	if runtime.GOOS != "darwin" {
		return errors.New("此平台不支援垃圾桶")
	}
	homeDirectory, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	trashDirectory := filepath.Join(homeDirectory, ".Trash")
	if err := os.MkdirAll(trashDirectory, 0o700); err != nil {
		return err
	}
	targetPath := availableTrashPath(trashDirectory, filepath.Base(filePath))
	if err := os.Rename(filePath, targetPath); err == nil {
		return nil
	}
	if err := duplicateFile(filePath, targetPath); err != nil {
		return err
	}
	return os.Remove(filePath)
}

func availableTrashPath(trashDirectory string, name string) string {
	extension := filepath.Ext(name)
	stem := strings.TrimSuffix(name, extension)
	candidate := filepath.Join(trashDirectory, name)
	for index := 1; index < 1000; index++ {
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
		candidate = filepath.Join(trashDirectory, fmt.Sprintf("%s %d%s", stem, index, extension))
	}
	return candidate
}
