package app

import (
	"context"
	"errors"
	"os"
	"sync"
	"time"

	"github.com/VaderChen/FastFileViewer/internal/updater"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type UpdateState struct {
	Phase          string           `json:"phase"`
	CurrentVersion string           `json:"currentVersion"`
	Release        *updater.Release `json:"release,omitempty"`
	Bytes          int64            `json:"bytes"`
	Error          string           `json:"error"`
	InstallError   string           `json:"installError"`
}

// Progress snapshots avoid repeatedly serializing immutable release notes.
type UpdateProgress struct {
	Phase          string `json:"phase"`
	CurrentVersion string `json:"currentVersion"`
	ReleaseTag     string `json:"releaseTag"`
	Bytes          int64  `json:"bytes"`
	Error          string `json:"error"`
	InstallError   string `json:"installError"`
}

type UpdateService struct {
	mu              sync.Mutex
	ctx             context.Context
	cancel          context.CancelFunc
	operationCancel context.CancelFunc
	wg              sync.WaitGroup
	closed          bool
	state           UpdateState
	client          *updater.Client
	checkedAt       time.Time
	latest          func(context.Context) (updater.Release, error)
	capability      func(context.Context) error
	prepare         func(context.Context, *updater.Client, updater.Release, string, func(string, int64)) (string, func(), error)
	launch          func(context.Context, string) error
	quit            func()
}

func newUpdateService() *UpdateService {
	ctx, cancel := context.WithCancel(context.Background())
	client := updater.NewClient()
	return &UpdateService{ctx: ctx, cancel: cancel, client: client, latest: client.Latest,
		capability: updater.Capability, prepare: updater.Prepare, launch: updater.LaunchInstaller,
		state: UpdateState{Phase: "idle", CurrentVersion: updater.CurrentVersion(appVersion, appTag)}}
}

func (u *UpdateService) startup(ctx context.Context) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.cancel()
	u.ctx, u.cancel = context.WithCancel(ctx)
	u.quit = func() { wailsruntime.Quit(ctx) }
}

func updateBusy(phase string) bool {
	switch phase {
	case "checking", "downloading", "verifying", "preparing", "restarting":
		return true
	}
	return false
}

// GetUpdateState includes the release details for the update dialog.
func (u *UpdateService) GetUpdateState() UpdateState {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.state
}

func (u *UpdateService) GetUpdateProgress() UpdateProgress {
	u.mu.Lock()
	defer u.mu.Unlock()
	state := u.state
	progress := UpdateProgress{Phase: state.Phase, CurrentVersion: state.CurrentVersion,
		Bytes: state.Bytes, Error: state.Error, InstallError: state.InstallError}
	if state.Release != nil {
		progress.ReleaseTag = state.Release.Tag
	}
	return progress
}

// Called by React after mounting, so a successful restart includes a working UI.
func (u *UpdateService) FrontendReady() { updater.AcknowledgeLaunch(os.Args[1:]) }

func (u *UpdateService) CheckForUpdates() UpdateState {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.closed || updateBusy(u.state.Phase) {
		return u.state
	}
	if time.Since(u.checkedAt) < time.Minute && (u.state.Phase == "available" || u.state.Phase == "current") {
		return u.state
	}
	if _, err := updater.Newer(u.state.CurrentVersion, u.state.CurrentVersion); err != nil {
		u.state.Phase, u.state.Error = "error", "version"
		return u.state
	}
	u.state.Phase, u.state.Error, u.state.Release, u.state.InstallError = "checking", "", nil, ""
	ctx, cancel := context.WithCancel(u.ctx)
	u.operationCancel = cancel
	u.wg.Add(1)
	go func() {
		defer u.wg.Done()
		defer cancel()
		release, err := u.latest(ctx)
		available := false
		if err == nil {
			available, err = updater.Newer(release.Tag, u.state.CurrentVersion)
		}
		installError := ""
		if err == nil && available {
			if capabilityErr := u.capability(ctx); capabilityErr != nil {
				installError = updateErrorCode(capabilityErr)
			}
		}
		u.mu.Lock()
		defer u.mu.Unlock()
		if u.closed {
			return
		}
		u.operationCancel = nil
		if err != nil || ctx.Err() != nil {
			if ctx.Err() != nil {
				err = ctx.Err()
			}
			u.state.Phase, u.state.Error = "error", updateErrorCode(err)
			return
		}
		u.checkedAt = time.Now()
		u.state.Phase, u.state.Release, u.state.InstallError = "current", &release, installError
		if available {
			u.state.Phase = "available"
		}
	}()
	return u.state
}

func (u *UpdateService) InstallUpdate(locale string) UpdateState {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.closed || updateBusy(u.state.Phase) || u.state.Release == nil || u.state.InstallError != "" {
		return u.state
	}
	if newer, _ := updater.Newer(u.state.Release.Tag, u.state.CurrentVersion); !newer {
		return u.state
	}
	if locale != "zh-TW" && locale != "ja" {
		locale = "en"
	}
	release := *u.state.Release
	u.state.Phase, u.state.Bytes, u.state.Error = "downloading", 0, ""
	ctx, cancel := context.WithTimeout(u.ctx, 30*time.Minute)
	u.operationCancel = cancel
	u.wg.Add(1)
	go func() {
		defer u.wg.Done()
		defer cancel()
		root, cleanup, err := u.prepare(ctx, u.client, release, locale, func(phase string, bytes int64) {
			u.mu.Lock()
			defer u.mu.Unlock()
			if !u.closed {
				u.state.Phase, u.state.Bytes = phase, bytes
			}
		})
		handedOff := false
		defer func() {
			if !handedOff {
				cleanup()
			}
		}()
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		if err == nil {
			// Disable cancellation before launching the independent installer.
			u.mu.Lock()
			u.state.Phase = "restarting"
			u.mu.Unlock()
			err = u.launch(ctx, root)
		}
		u.mu.Lock()
		u.operationCancel = nil
		if err != nil {
			if !u.closed {
				u.state.Phase, u.state.Error = "error", updateErrorCode(err)
				if errors.Is(err, context.Canceled) {
					u.state.Phase = "cancelled"
				}
			}
			u.mu.Unlock()
			return
		}
		handedOff = true
		quit := u.quit
		u.mu.Unlock()
		if quit != nil {
			go quit()
		}
	}()
	return u.state
}

func (u *UpdateService) CancelUpdate() UpdateState {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.state.Phase != "restarting" && u.operationCancel != nil {
		u.operationCancel()
	}
	return u.state
}

func (u *UpdateService) cleanup() {
	u.mu.Lock()
	u.closed = true
	u.cancel()
	u.mu.Unlock()
	u.wg.Wait()
	u.client.Close()
}

func updateErrorCode(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	var fileError *os.PathError
	if errors.As(err, &fileError) {
		return "install"
	}
	switch err.Error() {
	case "version", "rate_limited", "invalid_release", "missing_asset", "checksum", "signature", "unsupported", "not_writable", "install", "restart", "system_version":
		return err.Error()
	}
	return "network"
}
