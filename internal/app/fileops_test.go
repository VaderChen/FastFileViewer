package app

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestRenameEntryValidatesNameAndRefreshesKind(t *testing.T) {
	root := t.TempDir()
	source := writeFileOperationFixture(t, root, "note.txt", "hello")
	service := New().File

	renamed, err := service.RenameEntry(source, "note.md")
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Name != "note.md" || renamed.Kind != "markdown" || renamed.ID != buildFileImageEntry(renamed.Path, 5).ID {
		t.Fatalf("改名後項目不正確: %#v", renamed)
	}
	for _, invalid := range []string{"", "../bad.txt", "folder/bad.txt", "folder\\bad.txt"} {
		if _, err := service.RenameEntry(renamed.Path, invalid); err == nil {
			t.Fatalf("應拒絕檔名 %q", invalid)
		}
	}
	existing := writeFileOperationFixture(t, root, "existing.md", "existing")
	if _, err := service.RenameEntry(renamed.Path, filepath.Base(existing)); err == nil {
		t.Fatal("改名不應覆寫既有檔案")
	}
	if _, err := service.RenameEntry(root+"/archive.zip::inside.txt", "new.txt"); err == nil {
		t.Fatal("不應改名壓縮檔內項目")
	}
}

func TestTrashEntriesKeepsBatchProgressAndDeduplicatesNames(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	left := writeFileOperationFixture(t, filepath.Join(t.TempDir(), "left"), "same.txt", "left")
	right := writeFileOperationFixture(t, filepath.Join(t.TempDir(), "right"), "same.txt", "right")
	missing := filepath.Join(t.TempDir(), "missing.txt")

	result, err := New().File.TrashEntries([]string{left, missing, right, left})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.RemovedIDs) != 2 || len(result.Failed) != 1 {
		t.Fatalf("批次垃圾桶結果不正確: %#v", result)
	}
	for _, name := range []string{"same.txt", "same 1.txt"} {
		if _, err := os.Stat(filepath.Join(home, ".Trash", name)); err != nil {
			t.Fatalf("垃圾桶缺少 %s: %v", name, err)
		}
	}
}

func TestMoveEntriesFallsBackToCopyAndDoesNotOverwrite(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(root, "destination")
	if err := os.Mkdir(destination, 0o700); err != nil {
		t.Fatal(err)
	}
	source := writeFileOperationFixture(t, filepath.Join(root, "source"), "move.txt", "content")
	originalRename := renameFile
	renameFile = func(oldPath string, newPath string) error {
		if oldPath == source {
			return &os.LinkError{Op: "rename", Old: oldPath, New: newPath, Err: syscall.EXDEV}
		}
		return originalRename(oldPath, newPath)
	}
	t.Cleanup(func() { renameFile = originalRename })

	result, err := New().File.MoveEntries([]string{source}, destination)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Moved) != 1 || result.Moved[0].DirectoryPath != destination {
		t.Fatalf("跨磁碟移動結果不正確: %#v", result)
	}
	if _, err := os.Stat(source); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("來源檔案應已移除: %v", err)
	}

	conflictSource := writeFileOperationFixture(t, filepath.Join(root, "other"), "move.txt", "other")
	conflict, err := New().File.MoveEntries([]string{conflictSource, root + "/archive.zip::inside.txt"}, destination)
	if err != nil {
		t.Fatal(err)
	}
	if len(conflict.Moved) != 0 || len(conflict.Failed) != 2 {
		t.Fatalf("目標衝突與壓縮檔拒絕結果不正確: %#v", conflict)
	}
}

func writeFileOperationFixture(t *testing.T, directory string, name string, content string) string {
	t.Helper()
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
