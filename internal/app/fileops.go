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
	"syscall"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// FileService 提供改名、移動與垃圾桶操作；檔案異動後會回傳可直接替換清單的項目。
type FileService struct {
	ctx     context.Context
	entries *entryRegistry
}

var renameFile = renameNoReplace

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
	if _, statErr := os.Lstat(targetPath); statErr == nil {
		return ImageEntry{}, errors.New("目標檔案已存在")
	} else if !os.IsNotExist(statErr) {
		return ImageEntry{}, statErr
	}
	if err := moveFileNoReplace(entry.Path, targetPath); err != nil {
		return ImageEntry{}, fmt.Errorf("改名失敗: %w", err)
	}
	info, err := movedFileInfo(targetPath)
	if err != nil {
		return ImageEntry{}, fmt.Errorf("讀取改名後檔案失敗: %w", err)
	}
	replacement := buildFileImageEntry(targetPath, info.Size())
	s.entries.replace(entry.ID, replacement)
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
		s.entries.forget(entry.ID)
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
	result := MoveResult{Moved: []ImageEntry{}, OriginalIDs: make(map[string]string), Failed: []FileOperationFailure{}}
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
		if _, statErr := os.Lstat(targetPath); statErr == nil {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: "目標檔案已存在"})
			continue
		} else if !os.IsNotExist(statErr) {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: statErr.Error()})
			continue
		}
		if err := moveFileNoReplace(entry.Path, targetPath); err != nil {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: fmt.Sprintf("移動失敗: %v", err)})
			continue
		}
		movedInfo, statErr := movedFileInfo(targetPath)
		if statErr != nil {
			result.Failed = append(result.Failed, FileOperationFailure{Path: filePath, Error: statErr.Error()})
			continue
		}
		moved := buildFileImageEntry(targetPath, movedInfo.Size())
		s.entries.replace(entry.ID, moved)
		result.Moved = append(result.Moved, moved)
		result.OriginalIDs[moved.ID] = entry.ID
	}
	return result, nil
}

func (s *FileService) SelectMoveDestination(dialogTitle string) (string, error) {
	if s.ctx == nil {
		return "", nil
	}
	return wailsruntime.OpenDirectoryDialog(s.ctx, wailsruntime.OpenDialogOptions{Title: strings.TrimSpace(dialogTitle)})
}

// movedFileInfo reports a moved symlink even when its relative target no longer
// resolves in the destination directory. A successful move must not be reported
// as a failure merely because following the moved link fails.
func movedFileInfo(path string) (os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err == nil && info.Mode()&os.ModeSymlink != 0 {
		if resolved, statErr := os.Stat(path); statErr == nil {
			return resolved, nil
		}
	}
	return info, err
}

// duplicateFile preserves symlinks and regular-file permissions and timestamps.
// Hard links avoid copying data when the filesystem supports them.
func duplicateFile(sourcePath string, targetPath string) error {
	return duplicateFileWithContext(context.Background(), sourcePath, targetPath)
}

func duplicateFileWithContext(ctx context.Context, sourcePath, targetPath string) error {
	createdInfo, err := duplicateFileInfo(ctx, sourcePath, targetPath)
	if err == nil {
		if err = checkOperation(ctx); err != nil {
			if rollbackErr := removeFileIfSame(targetPath, createdInfo); rollbackErr != nil {
				return errors.Join(err, rollbackErr)
			}
		}
	}
	return err
}

func duplicateFileInfo(ctx context.Context, sourcePath, targetPath string) (os.FileInfo, error) {
	if err := checkOperation(ctx); err != nil {
		return nil, err
	}
	info, err := os.Lstat(sourcePath)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		link, err := os.Readlink(sourcePath)
		if err != nil {
			return nil, err
		}
		if err := checkOperation(ctx); err != nil {
			return nil, err
		}
		if err := os.Symlink(link, targetPath); err != nil {
			return nil, err
		}
		return os.Lstat(targetPath)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("不支援複製此檔案種類: %s", sourcePath)
	}
	if err := checkOperation(ctx); err != nil {
		return nil, err
	}
	if err := os.Link(sourcePath, targetPath); err == nil {
		return os.Lstat(targetPath)
	}
	return copyRegularFile(ctx, sourcePath, targetPath)
}

// copyRegularFile is used when a hard link cannot cross a volume or is unsupported.
// Create privately first, then restore the original permissions only after copying.
func copyRegularFile(ctx context.Context, sourcePath, targetPath string) (createdInfo os.FileInfo, err error) {
	if err := checkOperation(ctx); err != nil {
		return nil, err
	}
	source, err := openRegularFile(sourcePath)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	sourceInfo, err := source.Stat()
	if err != nil {
		return nil, err
	}
	if !sourceInfo.Mode().IsRegular() {
		return nil, fmt.Errorf("不支援複製此檔案種類: %s", sourcePath)
	}
	target, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	createdInfo, err = target.Stat()
	if err != nil {
		_ = target.Close()
		return nil, err
	}
	defer func() {
		// ExFAT may replace a new file's temporary inode when blocks are
		// allocated. The still-open FD remains the authority for our output.
		if current, statErr := target.Stat(); statErr == nil {
			createdInfo = current
		}
		_ = target.Close()
		if err != nil {
			err = errors.Join(err, removeFileIfSame(targetPath, createdInfo))
		}
	}()
	if _, err = io.Copy(target, &contextReader{ctx: ctx, reader: source}); err != nil {
		return createdInfo, err
	}
	if err = checkOperation(ctx); err != nil {
		return createdInfo, err
	}
	latestSourceInfo, err := source.Stat()
	if err != nil {
		return createdInfo, err
	}
	if !os.SameFile(sourceInfo, latestSourceInfo) ||
		sourceInfo.Size() != latestSourceInfo.Size() || !sourceInfo.ModTime().Equal(latestSourceInfo.ModTime()) ||
		thumbnailFileIdentity(sourceInfo) != thumbnailFileIdentity(latestSourceInfo) {
		return createdInfo, fmt.Errorf("複製期間來源已變更: %s", sourcePath)
	}
	// A file replaced by another application no longer names our output FD.
	// Check before applying path-based timestamps or committing the move.
	createdInfo, err = target.Stat()
	if err != nil {
		return createdInfo, err
	}
	targetInfo, err := os.Lstat(targetPath)
	if err != nil {
		return createdInfo, err
	}
	if !os.SameFile(createdInfo, targetInfo) {
		return createdInfo, fmt.Errorf("複製期間目的地已變更: %s", targetPath)
	}
	if err = target.Chmod(sourceInfo.Mode().Perm()); err != nil {
		return createdInfo, err
	}
	if err = os.Chtimes(targetPath, sourceInfo.ModTime(), sourceInfo.ModTime()); err != nil {
		return createdInfo, err
	}
	if err = target.Sync(); err != nil {
		return createdInfo, err
	}
	createdInfo, err = target.Stat()
	if err != nil {
		return createdInfo, err
	}
	err = target.Close()
	return createdInfo, err
}

// Identity checks avoid ordinary rollback races with a replaced destination.
// They are not a filesystem transaction against malicious concurrent changes.
func removeFileIfSame(path string, expected os.FileInfo) error {
	current, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if expected == nil || !os.SameFile(current, expected) {
		return fmt.Errorf("目的地已變更，保留檔案: %s", path)
	}
	return os.Remove(path)
}

func moveToTrash(filePath string) error {
	return moveToTrashWithContext(context.Background(), filePath)
}

func moveToTrashWithContext(ctx context.Context, filePath string) error {
	if err := checkOperation(ctx); err != nil {
		return err
	}
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
	name := filepath.Base(filePath)
	extension := filepath.Ext(name)
	stem := strings.TrimSuffix(name, extension)
	for index := 0; index < 1000; index++ {
		candidate := name
		if index > 0 {
			candidate = fmt.Sprintf("%s %d%s", stem, index, extension)
		}
		err := moveFileNoReplaceWithContext(ctx, filePath, filepath.Join(trashDirectory, candidate))
		if !errors.Is(err, os.ErrExist) {
			return err
		}
	}
	return errors.New("垃圾桶中找不到可用的檔名")
}

// Only cross-device or unsupported native renames fall back to exclusive creation.
func moveFileNoReplace(sourcePath, targetPath string) error {
	return moveFileNoReplaceWithContext(context.Background(), sourcePath, targetPath)
}

func moveFileNoReplaceWithContext(ctx context.Context, sourcePath, targetPath string) error {
	if err := checkOperation(ctx); err != nil {
		return err
	}
	err := renameFile(sourcePath, targetPath)
	if err == nil {
		return nil
	}
	if !errors.Is(err, syscall.EXDEV) && !errors.Is(err, syscall.ENOTSUP) {
		return err
	}
	originalInfo, err := os.Lstat(sourcePath)
	if err != nil {
		return err
	}
	createdInfo, err := duplicateFileInfo(ctx, sourcePath, targetPath)
	if err != nil {
		return err
	}
	// Cancellation is safe only before the source is removed. Once a native
	// rename or this removal commits the move, report success even if cancelled.
	if err := checkOperation(ctx); err != nil {
		if rollbackErr := removeFileIfSame(targetPath, createdInfo); rollbackErr != nil {
			return errors.Join(err, rollbackErr)
		}
		return err
	}
	currentInfo, err := os.Lstat(sourcePath)
	// Creating a hard link changes ctime itself, and the destination shares any
	// subsequent content changes. Independent copies need the full source version.
	copiedSeparately := !os.SameFile(originalInfo, createdInfo)
	if err != nil || !os.SameFile(originalInfo, currentInfo) ||
		originalInfo.Size() != currentInfo.Size() || !originalInfo.ModTime().Equal(currentInfo.ModTime()) ||
		(copiedSeparately && thumbnailFileIdentity(originalInfo) != thumbnailFileIdentity(currentInfo)) {
		// Preserve both paths when the source changed during the copy.
		return fmt.Errorf("複製期間來源已變更，已保留目的地複本: %s", targetPath)
	}
	currentTarget, err := os.Lstat(targetPath)
	if err != nil || !os.SameFile(createdInfo, currentTarget) {
		return fmt.Errorf("複製期間目的地已變更，已保留來源: %s", sourcePath)
	}
	if err := os.Remove(sourcePath); err != nil {
		if rollbackErr := removeFileIfSame(targetPath, createdInfo); rollbackErr != nil {
			return errors.Join(err, rollbackErr)
		}
		return err
	}
	return nil
}
