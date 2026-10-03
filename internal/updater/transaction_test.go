package updater

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestInstallTransactionPreservesOriginalUntilNewUIReady(t *testing.T) {
	for _, failure := range []string{"", "verification", "save original", "install", "launch", "restore", "running new process"} {
		t.Run(failure, func(t *testing.T) {
			parent := t.TempDir()
			job := installJob{Root: filepath.Join(parent, "staging"), Target: filepath.Join(parent, "Application.app")}
			for path, contents := range map[string]string{job.Target: "old", job.staged(): "new"} {
				if err := os.MkdirAll(path, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(path, "version"), []byte(contents), 0600); err != nil {
					t.Fatal(err)
				}
			}
			renamed := 0
			reopened := false
			launched := false
			progress := 0
			actions := installActions{
				verify: func(context.Context, installJob) error {
					if failure == "verification" {
						return errors.New("signature")
					}
					return nil
				},
				rename: func(from, to string) error {
					renamed++
					if (failure == "save original" && renamed == 1) || (failure == "install" && renamed == 2) || (failure == "restore" && renamed == 3) {
						return errors.New("disk error")
					}
					if _, err := os.Lstat(to); err == nil {
						return errors.New("target exists")
					}
					return os.Rename(from, to)
				},
				launch: func(_ context.Context, path, receipt string) error {
					launched = true
					old, _ := os.ReadFile(filepath.Join(job.backup(), "version"))
					newVersion, _ := os.ReadFile(filepath.Join(path, "version"))
					if string(old) != "old" || string(newVersion) != "new" {
						t.Fatal("original not retained during launch")
					}
					if failure == "launch" || failure == "restore" {
						return errors.New("crash before UI")
					}
					if failure == "running new process" {
						return errNewProcessRunning
					}
					return nil
				},
				reopen: func(path string) error {
					reopened = true
					data, _ := os.ReadFile(filepath.Join(path, "version"))
					if string(data) != "old" {
						t.Fatal("did not reopen original")
					}
					return nil
				},
				phase: func(_ string, value int) { progress = value },
			}
			err := installTransaction(context.Background(), job, actions)
			if failure == "" {
				if err != nil || !launched || reopened || progress != 100 {
					t.Fatalf("success: %v", err)
				}
				if _, err := os.Stat(job.backup()); !os.IsNotExist(err) {
					t.Fatal("backup retained after acknowledgment")
				}
			} else if failure == "restore" || failure == "running new process" {
				if err == nil || err.Error() != "recovery" {
					t.Fatal(err)
				}
				data, _ := os.ReadFile(filepath.Join(job.backup(), "version"))
				if string(data) != "old" {
					t.Fatal("lost original after rollback failure")
				}
			} else {
				if err == nil || !reopened {
					t.Fatalf("failure not recovered: %v", err)
				}
				data, _ := os.ReadFile(filepath.Join(job.Target, "version"))
				if string(data) != "old" {
					t.Fatal("original changed")
				}
			}
		})
	}
}
