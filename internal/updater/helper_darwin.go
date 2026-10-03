package updater

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed ui/index.html ui/installer.js ui/installer.css
var installerAssets embed.FS

type InstallProgress struct {
	Phase   string `json:"phase"`
	Percent int    `json:"percent"`
	Error   string `json:"error"`
	Locale  string `json:"locale"`
	Version string `json:"version"`
}

// Installer runs in a detached copy of the old executable. Its small window stays
// alive while both application bundles are closed or replaced.
type Installer struct {
	mu    sync.Mutex
	once  sync.Once
	ctx   context.Context
	job   installJob
	state InstallProgress
}

func (i *Installer) GetProgress() InstallProgress {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.state
}

func (i *Installer) setPhase(phase string, percent int) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.state.Phase, i.state.Percent = phase, percent
}

// Begin is called after the progress window has rendered, before the parent quits.
func (i *Installer) Begin() {
	i.once.Do(func() { go i.run() })
}

func (i *Installer) Close() {
	phase := i.GetProgress().Phase
	if phase == "error" || phase == "complete" {
		wailsruntime.Quit(i.ctx)
	}
}

func (i *Installer) run() {
	err := os.WriteFile(filepath.Join(i.job.Root, "ready"), []byte("ready\n"), 0600)
	if err == nil {
		err = waitForParent(i.job.ParentPID, 90*time.Second)
	}
	if err == nil {
		err = installTransaction(i.ctx, i.job, installActions{
			verify: func(ctx context.Context, job installJob) error {
				if err := verifyBundle(ctx, job.Target, job.Team, job.BundleID, ""); err != nil {
					return err
				}
				return verifyBundle(ctx, job.staged(), job.Team, job.BundleID, job.Release.Tag)
			},
			rename: renameExclusive, launch: launchUpdated, reopen: reopenApp, phase: i.setPhase,
		})
	}
	if err != nil {
		i.mu.Lock()
		i.state.Phase, i.state.Error = "error", err.Error()
		i.mu.Unlock()
		return
	}
	time.AfterFunc(time.Second, func() { wailsruntime.Quit(i.ctx) })
}

func waitForParent(pid int, timeout time.Duration) error {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	for {
		if err := syscall.Kill(pid, 0); errors.Is(err, syscall.ESRCH) {
			return nil
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			return errors.New("parent_running")
		}
	}
}

func readJob(path string) (installJob, error) {
	var job installJob
	root := filepath.Dir(path)
	resolved, err := filepath.EvalSymlinks(root)
	info, statErr := os.Lstat(root)
	if err != nil || statErr != nil || resolved != root || !info.IsDir() || info.Mode().Perm() != 0700 ||
		!strings.HasPrefix(filepath.Base(root), stagingPrefix) || filepath.Base(path) != "job.json" {
		return job, errors.New("invalid update job")
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); !ok || stat.Uid != uint32(os.Geteuid()) {
		return job, errors.New("invalid update owner")
	}
	fileInfo, err := os.Lstat(path)
	if err != nil || !fileInfo.Mode().IsRegular() || fileInfo.Size() > 64<<10 {
		return job, errors.New("invalid update job")
	}
	file, err := os.Open(path)
	if err != nil {
		return job, err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 64<<10))
	if err := decoder.Decode(&job); err != nil {
		return job, err
	}
	job.Root = root
	if filepath.Dir(job.Target) != filepath.Dir(root) || filepath.Ext(job.Target) != ".app" ||
		job.ParentPID <= 1 || job.ParentPID == os.Getpid() || !identityPattern.MatchString(job.Team) ||
		!identityPattern.MatchString(job.BundleID) {
		return job, errors.New("invalid update job")
	}
	if _, ok := parseVersion(job.Release.Tag); !ok {
		return job, errors.New("invalid update version")
	}
	return job, nil
}

func RunInstaller(arguments []string) (bool, error) {
	if len(arguments) == 0 || arguments[0] != helperFlag {
		return false, nil
	}
	if len(arguments) != 2 {
		return true, errors.New("invalid update arguments")
	}
	job, err := readJob(arguments[1])
	if err != nil {
		return true, err
	}
	defer func() {
		// If recovery failed, preserve the original bundle for manual recovery.
		if _, err := os.Lstat(job.backup()); os.IsNotExist(err) {
			_ = os.RemoveAll(job.Root)
		}
	}()
	assets, err := fs.Sub(installerAssets, "ui")
	if err != nil {
		return true, err
	}
	installer := &Installer{job: job, state: InstallProgress{Phase: "waiting", Percent: 80, Locale: job.Locale, Version: job.Release.Version}}
	err = wails.Run(&options.App{
		Title: "FastFileViewer", Width: 480, Height: 250, DisableResize: true, AlwaysOnTop: true,
		BackgroundColour: &options.RGBA{R: 251, G: 252, B: 250, A: 1},
		AssetServer:      &assetserver.Options{Assets: assets}, Bind: []interface{}{installer},
		OnStartup: func(ctx context.Context) { installer.ctx = ctx },
		OnBeforeClose: func(context.Context) bool {
			phase := installer.GetProgress().Phase
			return phase != "error" && phase != "complete"
		},
	})
	return true, err
}
