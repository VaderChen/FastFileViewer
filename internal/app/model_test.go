package app

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
)

func modelRequest(s *MediaService, method, target string) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	NewMediaMiddleware(s)(http.NotFoundHandler()).ServeHTTP(response, httptest.NewRequest(method, target, nil))
	return response
}

func TestModelsScanAndOpenWithIndependentFilter(t *testing.T) {
	root := t.TempDir()
	for _, ext := range append(append([]string{}, supportedModelExtensions...), ".txt", ".bin", ".mtl") {
		if err := os.WriteFile(filepath.Join(root, "item"+ext), []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := New()
	defer s.Shutdown()
	for _, ext := range supportedModelExtensions {
		entry, err := s.Library.OpenFileByPath(filepath.Join(root, "item"+ext))
		if err != nil || entry.Kind != "model" {
			t.Fatalf("open %s: %+v %v", ext, entry, err)
		}
	}
	all, err := s.Library.ScanDirectory(root, []string{}, []string{}, nil, []string{}, 0)
	if err != nil || len(all.Node.Images) != len(supportedModelExtensions) {
		t.Fatalf("all models: %+v %v", all, err)
	}
	selected, err := s.Library.ScanDirectory(root, nil, nil, []string{"GLB", ".STL", ".txt"}, nil, 0)
	if err != nil || len(selected.Node.Images) != 3 {
		t.Fatalf("model filter: %+v %v", selected, err)
	}
	disabled, err := s.Library.ScanDirectory(root, nil, nil, []string{}, nil, 0)
	if err != nil || len(disabled.Node.Images) != 1 || disabled.Node.Images[0].Kind != "text" {
		t.Fatalf("disabled: %+v %v", disabled, err)
	}
	bootstrap := s.Library.Bootstrap()
	if len(bootstrap.SupportedModels) != 7 {
		t.Fatal(bootstrap.SupportedModels)
	}
	bootstrap.SupportedModels[0] = "changed"
	if supportedModelExtensions[0] != ".glb" {
		t.Fatal("bootstrap aliases model formats")
	}
}

func TestModelResourcesLocalScopeAndRange(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "textures"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string]string{"模型 #1.gltf": "model", "mesh.bin": "0123456789", "textures/貼圖 %.png": "texture", "private.txt": "secret"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := New()
	defer s.Shutdown()
	modelURL, err := s.Media.PrepareModelByPath(filepath.Join(root, "模型 #1.gltf"))
	if err != nil {
		t.Fatal(err)
	}
	base := modelURL[:strings.LastIndex(modelURL, "/")+1]
	for resource, expected := range map[string]string{url.PathEscape("模型 #1.gltf"): "model", "mesh.bin": "0123456789", "textures/" + url.PathEscape("貼圖 %.png"): "texture"} {
		response := modelRequest(s.Media, http.MethodGet, base+resource)
		if response.Code != 200 || response.Body.String() != expected {
			t.Fatalf("%s: %d %q", resource, response.Code, response.Body.String())
		}
		if response.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal("missing response guard")
		}
	}
	request := httptest.NewRequest(http.MethodGet, base+"mesh.bin", nil)
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	s.Media.serveModel(response, request)
	if response.Code != 206 || response.Body.String() != "2345" {
		t.Fatalf("range: %d %s", response.Code, response.Body.String())
	}
	if response := modelRequest(s.Media, http.MethodHead, modelURL); response.Code != 200 || response.Body.Len() != 0 {
		t.Fatalf("head: %+v", response)
	}
	for _, resource := range []string{"../mesh.bin", "%2e%2e/mesh.bin", "%2fmesh.bin", "textures/%2e%2e/mesh.bin", "textures%5cmesh.bin", "private.txt", ".hidden.png", "missing.bin"} {
		if response := modelRequest(s.Media, http.MethodGet, base+resource); response.Code != 404 {
			t.Fatalf("accepted %q: %d", resource, response.Code)
		}
	}
	if modelRequest(s.Media, http.MethodPost, modelURL).Code != 405 {
		t.Fatal("accepted POST")
	}
	if modelRequest(s.Media, http.MethodGet, modelURLPrefix+"unknown/model.glb").Code != 404 {
		t.Fatal("accepted unknown model")
	}
	if _, err := s.Media.PrepareModelByPath(filepath.Join(root, "private.txt")); err == nil {
		t.Fatal("accepted document as model")
	}
	outside := filepath.Join(t.TempDir(), "outside.png")
	if err := os.WriteFile(outside, []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape.png")); err != nil {
		t.Fatal(err)
	}
	if modelRequest(s.Media, http.MethodGet, base+"escape.png").Code != 404 {
		t.Fatal("followed external symlink")
	}
	if err := os.Symlink("mesh.bin", filepath.Join(root, "alias.bin")); err != nil {
		t.Fatal(err)
	}
	if modelRequest(s.Media, http.MethodGet, base+"alias.bin").Code != 200 {
		t.Fatal("rejected in-scope symlink")
	}
	if err := os.Truncate(filepath.Join(root, "mesh.bin"), maxModelResourceBytes+1); err != nil {
		t.Fatal(err)
	}
	if modelRequest(s.Media, http.MethodGet, base+"mesh.bin").Code != 413 {
		t.Fatal("accepted oversized resource")
	}
}

func TestModelResourcesInsideArchives(t *testing.T) {
	for _, ext := range []string{".zip", ".tar"} {
		t.Run(ext, func(t *testing.T) {
			root := t.TempDir()
			archivePath := filepath.Join(root, "models"+ext)
			var archive bytes.Buffer
			contents := map[string]string{"kit/model.gltf": "model", "kit/mesh.bin": "buffer", "kit/textures/圖片.png": "texture", "other/outside.bin": "outside"}
			if ext == ".zip" {
				writer := zip.NewWriter(&archive)
				for name, content := range contents {
					file, err := writer.Create(name)
					if err != nil {
						t.Fatal(err)
					}
					if _, err := file.Write([]byte(content)); err != nil {
						t.Fatal(err)
					}
				}
				if err := writer.Close(); err != nil {
					t.Fatal(err)
				}
			} else {
				writer := tar.NewWriter(&archive)
				for name, content := range contents {
					if err := writer.WriteHeader(&tar.Header{Name: name, Size: int64(len(content)), Mode: 0600}); err != nil {
						t.Fatal(err)
					}
					if _, err := writer.Write([]byte(content)); err != nil {
						t.Fatal(err)
					}
				}
				if err := writer.Close(); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(archivePath, archive.Bytes(), 0600); err != nil {
				t.Fatal(err)
			}
			s := New()
			defer s.Shutdown()
			scan, err := s.Library.ScanDirectory(root, []string{}, []string{}, []string{".gltf"}, []string{}, 0)
			if err != nil || len(scan.Node.Children) != 1 || scan.Node.Children[0].Children[0].Images[0].Kind != "model" {
				t.Fatalf("archive scan: %+v %v", scan, err)
			}
			modelURL, err := s.Media.PrepareModelByPath(archivePath + "::kit/model.gltf")
			if err != nil {
				t.Fatal(err)
			}
			base := path.Dir(modelURL) + "/"
			for resource, want := range map[string]string{"model.gltf": "model", "mesh.bin": "buffer", "textures/" + url.PathEscape("圖片.png"): "texture"} {
				response := modelRequest(s.Media, http.MethodGet, base+resource)
				if response.Code != 200 || response.Body.String() != want {
					t.Fatalf("archive resource %s: %d %q", resource, response.Code, response.Body.String())
				}
			}
			if modelRequest(s.Media, http.MethodGet, base+"../other/outside.bin").Code != 404 {
				t.Fatal("escaped model directory")
			}
		})
	}
}
