package updater

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

const helperFlag = "--fastfileviewer-install-update"
const receiptFlag = "--fastfileviewer-update-receipt"
const stagingPrefix = ".FastFileViewer-update-"

var errNewProcessRunning = errors.New("new update process has not stopped")

type installJob struct {
	Target    string  `json:"target"`
	ParentPID int     `json:"parentPid"`
	Team      string  `json:"team"`
	BundleID  string  `json:"bundleId"`
	Release   Release `json:"release"`
	Locale    string  `json:"locale"`
	Root      string  `json:"-"`
}

func (j installJob) staged() string  { return filepath.Join(j.Root, "FastFileViewer.app") }
func (j installJob) backup() string  { return filepath.Join(j.Root, "previous.app") }
func (j installJob) receipt() string { return filepath.Join(j.Root, "started") }

type installActions struct {
	verify func(context.Context, installJob) error
	rename func(string, string) error
	launch func(context.Context, string, string) error
	reopen func(string) error
	phase  func(string, int)
}

// The old bundle is kept until the new process acknowledges that its UI is ready.
// Every rename refuses to replace an unexpected file created by another process.
func installTransaction(ctx context.Context, job installJob, actions installActions) error {
	actions.phase("installing", 85)
	if err := actions.verify(ctx, job); err != nil {
		_ = actions.reopen(job.Target)
		return errors.New("signature")
	}
	if err := actions.rename(job.Target, job.backup()); err != nil {
		_ = actions.reopen(job.Target)
		return errors.New("install")
	}
	if err := actions.rename(job.staged(), job.Target); err != nil {
		if actions.rename(job.backup(), job.Target) != nil {
			return errors.New("recovery")
		}
		_ = actions.reopen(job.Target)
		return errors.New("install")
	}
	actions.phase("restarting", 95)
	if err := actions.launch(ctx, job.Target, job.receipt()); err != nil {
		if errors.Is(err, errNewProcessRunning) {
			return errors.New("recovery")
		}
		// launch must stop the failed new process before returning an error.
		if actions.rename(job.Target, job.staged()) != nil || actions.rename(job.backup(), job.Target) != nil {
			return errors.New("recovery")
		}
		_ = actions.reopen(job.Target)
		return errors.New("restart")
	}
	_ = os.RemoveAll(job.backup())
	actions.phase("complete", 100)
	return nil
}

// FileArguments prevents the private restart handshake from being opened as a document.
func FileArguments(arguments []string) []string {
	result := make([]string, 0, len(arguments))
	for i := 0; i < len(arguments); i++ {
		if arguments[i] == receiptFlag {
			i++
			continue
		}
		result = append(result, arguments[i])
	}
	return result
}
