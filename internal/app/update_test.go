package app

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/VaderChen/FastFileViewer/internal/updater"
)

func testUpdateService(t *testing.T) *UpdateService {
	t.Helper()
	u := newUpdateService()
	u.state.CurrentVersion = "1.26.1003 build 2100"
	u.capability = func(context.Context) error { return nil }
	u.latest = func(context.Context) (updater.Release, error) {
		return updater.Release{Tag: "1.26.1003-build-2200", Version: "1.26.1003 build 2200", Size: 100}, nil
	}
	t.Cleanup(u.cleanup)
	return u
}

func waitUpdatePhase(t *testing.T, u *UpdateService, phase string) UpdateState {
	t.Helper()
	deadline := time.After(3 * time.Second)
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		state := u.GetUpdateState()
		if state.Phase == phase {
			return state
		}
		select {
		case <-ticker.C:
		case <-deadline:
			t.Fatalf("wanted %s, got %+v", phase, state)
		}
	}
}

func TestUpdateCheckSingleFlightAndNoDowngrade(t *testing.T) {
	u := testUpdateService(t)
	release := make(chan struct{})
	var calls atomic.Int32
	u.latest = func(ctx context.Context) (updater.Release, error) {
		calls.Add(1)
		select {
		case <-release:
		case <-ctx.Done():
			return updater.Release{}, ctx.Err()
		}
		return updater.Release{Tag: "v1.26.1003-r2"}, nil
	}
	u.CheckForUpdates()
	u.CheckForUpdates()
	u.CheckForUpdates()
	close(release)
	waitUpdatePhase(t, u, "current")
	u.CheckForUpdates()
	if calls.Load() != 1 {
		t.Fatalf("duplicate checks: %d", calls.Load())
	}
	if u.InstallUpdate("en").Phase != "current" {
		t.Fatal("offered downgrade")
	}
}

func TestUpdateCancellationNeverQuitsAndCleansPartialFiles(t *testing.T) {
	u := testUpdateService(t)
	var cleaned, launched, quit atomic.Bool
	u.prepare = func(ctx context.Context, _ *updater.Client, _ updater.Release, _ string, progress func(string, int64)) (string, func(), error) {
		progress("downloading", 20)
		<-ctx.Done()
		return "", func() { cleaned.Store(true) }, ctx.Err()
	}
	u.launch = func(context.Context, string) error { launched.Store(true); return nil }
	u.quit = func() { quit.Store(true) }
	u.CheckForUpdates()
	waitUpdatePhase(t, u, "available")
	u.InstallUpdate("zh-TW")
	u.CancelUpdate()
	waitUpdatePhase(t, u, "cancelled")
	u.wg.Wait()
	if !cleaned.Load() || launched.Load() || quit.Load() {
		t.Fatal("cancellation handed off or failed to clean up")
	}
}

func TestUpdateHandoffWaitsForInstallerAndOnlyRunsOnce(t *testing.T) {
	u := testUpdateService(t)
	var prepared atomic.Int32
	var cleaned atomic.Bool
	ready := make(chan struct{})
	quit := make(chan struct{}, 1)
	u.prepare = func(context.Context, *updater.Client, updater.Release, string, func(string, int64)) (string, func(), error) {
		prepared.Add(1)
		return "staging", func() { cleaned.Store(true) }, nil
	}
	u.launch = func(ctx context.Context, _ string) error {
		select {
		case <-ready:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	u.quit = func() { quit <- struct{}{} }
	u.CheckForUpdates()
	waitUpdatePhase(t, u, "available")
	u.InstallUpdate("en")
	u.InstallUpdate("en")
	waitUpdatePhase(t, u, "restarting")
	u.CancelUpdate()
	select {
	case <-quit:
		t.Fatal("quit before independent installer was ready")
	default:
	}
	close(ready)
	select {
	case <-quit:
	case <-time.After(time.Second):
		t.Fatal("did not quit after handoff")
	}
	u.wg.Wait()
	if prepared.Load() != 1 || cleaned.Load() {
		t.Fatal("duplicate install or deleted handed-off bundle")
	}
}

func TestUpdateFailuresKeepAppRunning(t *testing.T) {
	for _, cause := range []string{"checksum", "signature", "install"} {
		t.Run(cause, func(t *testing.T) {
			u := testUpdateService(t)
			var cleaned, quit atomic.Bool
			u.prepare = func(context.Context, *updater.Client, updater.Release, string, func(string, int64)) (string, func(), error) {
				return "", func() { cleaned.Store(true) }, errors.New(cause)
			}
			u.quit = func() { quit.Store(true) }
			u.CheckForUpdates()
			waitUpdatePhase(t, u, "available")
			u.InstallUpdate("en")
			state := waitUpdatePhase(t, u, "error")
			u.wg.Wait()
			if state.Error != cause || !cleaned.Load() || quit.Load() {
				t.Fatalf("failure mishandled: %+v", state)
			}
		})
	}
}

func TestUpdateShutdownCancelsCheckAndRejectsNewWork(t *testing.T) {
	u := testUpdateService(t)
	started := make(chan struct{})
	u.latest = func(ctx context.Context) (updater.Release, error) {
		close(started)
		<-ctx.Done()
		return updater.Release{}, ctx.Err()
	}
	u.CheckForUpdates()
	<-started
	u.cleanup()
	u.CheckForUpdates()
	if !u.closed {
		t.Fatal("not closed")
	}
}

func TestUpdateCheckExplainsReadOnlyInstallation(t *testing.T) {
	u := testUpdateService(t)
	u.capability = func(context.Context) error { return errors.New("not_writable") }
	u.CheckForUpdates()
	state := waitUpdatePhase(t, u, "available")
	if state.InstallError != "not_writable" || u.InstallUpdate("en").Phase != "available" {
		t.Fatal("read-only update started")
	}
}
