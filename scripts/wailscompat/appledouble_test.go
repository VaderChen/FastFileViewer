package build

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestCleanFFVBundleForSigning(t *testing.T) {
	root := t.TempDir()
	bundle := filepath.Join(root, "Model Viewer.app")
	binary := filepath.Join(bundle, "Contents", "MacOS", "Viewer")
	header := []byte{0, 5, 22, 7, 0, 2, 0, 0}
	files := map[string][]byte{
		"Model Viewer.app/Contents/MacOS/Viewer":         []byte("executable fixture"),
		"Model Viewer.app/Contents/Info.plist":           []byte("plist fixture"),
		"Model Viewer.app/Contents/Resources/._notes":    []byte("ordinary resource"),
		"Model Viewer.app/Contents/Resources/._empty":    {},
		"Model Viewer.app/Contents/Resources/._short":    header[:4],
		"Model Viewer.app/Contents/Resources/._version1": {0, 5, 22, 7, 0, 1, 0, 0},
		"Model Viewer.app/Contents/Resources/data":       header,
		"outside/._keep": header,
	}
	write := func(relative string, data []byte) {
		t.Helper()
		path := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for name, data := range files {
		write(name, data)
	}
	// A resource link must not expand the cleanup scope outside the bundle.
	link := filepath.Join(bundle, "Contents/Resources/external")
	if err := os.Symlink(filepath.Join(root, "outside"), link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "outside/._keep"), filepath.Join(bundle, "Contents/Resources/._link")); err != nil {
		t.Fatal(err)
	}
	metadata := []string{
		"Model Viewer.app/._Contents",
		"Model Viewer.app/Contents/._Info.plist",
		"Model Viewer.app/Contents/MacOS/._Viewer",
		"Model Viewer.app/Contents/Resources/子目錄/._texture.png",
	}
	// Recreate metadata just as a hot rebuild does, then repeat the cleanup.
	for attempt := 0; attempt < 2; attempt++ {
		for _, name := range metadata {
			write(name, append(append([]byte{}, header...), make([]byte, 64)...))
		}
		if err := cleanFFVBundleForSigning(binary); err != nil {
			t.Fatal(err)
		}
		for _, name := range metadata {
			if _, err := os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
				t.Errorf("metadata remains: %s: %v", name, err)
			}
		}
		for name, want := range files {
			got, err := os.ReadFile(filepath.Join(root, name))
			if err != nil || !bytes.Equal(got, want) {
				t.Errorf("file changed: %s: %v", name, err)
			}
		}
		if _, err := os.Lstat(filepath.Join(bundle, "Contents/Resources/._link")); err != nil {
			t.Fatal("resource symlink was removed:", err)
		}
	}
}

func TestCleanFFVBundleRejectsNonBundlePaths(t *testing.T) {
	for _, binary := range []string{
		"Viewer", "build/bin/Viewer", "build/Contents/MacOS/Viewer",
		"build/Viewer.app/Resources/MacOS/Viewer", "build/Viewer.app/Contents/Viewer",
	} {
		if err := cleanFFVBundleForSigning(binary); err == nil {
			t.Errorf("unexpected cleanup accepted: %s", binary)
		}
	}
}
