package updater

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestInstallerJobRejectsUntrustedPaths(t *testing.T) {
	for _, scenario := range []string{"valid", "outside target", "public directory", "symlink", "invalid identity"} {
		t.Run(scenario, func(t *testing.T) {
			parent, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			root := filepath.Join(parent, stagingPrefix+"test")
			if err := os.Mkdir(root, 0700); err != nil {
				t.Fatal(err)
			}
			job := installJob{Target: filepath.Join(parent, "App.app"), ParentPID: 2, Team: "EXAMPLETEAM", BundleID: "com.example.app", Release: Release{Tag: "1.26.1003-build-2200"}}
			switch scenario {
			case "outside target":
				job.Target = filepath.Join(parent, "outside", "App.app")
			case "public directory":
				_ = os.Chmod(root, 0755)
			case "invalid identity":
				job.Team = `injected" requirement`
			case "symlink":
				link := filepath.Join(parent, stagingPrefix+"link")
				if err := os.Symlink(root, link); err != nil {
					t.Fatal(err)
				}
				root = link
			}
			payload, _ := json.Marshal(job)
			if err := os.WriteFile(filepath.Join(root, "job.json"), payload, 0600); err != nil {
				t.Fatal(err)
			}
			_, err = readJob(filepath.Join(root, "job.json"))
			if (err == nil) != (scenario == "valid") {
				t.Fatalf("%s: %v", scenario, err)
			}
		})
	}
}

func TestNativeRestartWaitsForUIReceipt(t *testing.T) {
	for _, acknowledge := range []bool{true, false} {
		t.Run(map[bool]string{true: "ready", false: "crash before UI"}[acknowledge], func(t *testing.T) {
			root := t.TempDir()
			target := filepath.Join(root, "App.app")
			executable := filepath.Join(target, "Contents", "MacOS", "FastFileViewer")
			if err := os.MkdirAll(filepath.Dir(executable), 0700); err != nil {
				t.Fatal(err)
			}
			script := "#!/bin/sh\nexit 1\n"
			if acknowledge {
				script = "#!/bin/sh\n/usr/bin/touch \"$2\"\n/bin/sleep 2\n"
			}
			if err := os.WriteFile(executable, []byte(script), 0700); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			err := launchUpdated(ctx, target, filepath.Join(root, "started"))
			if (err == nil) != acknowledge {
				t.Fatalf("acknowledge=%v err=%v", acknowledge, err)
			}
		})
	}
}

// Release validation can exercise real Developer ID/Gatekeeper checks without
// modifying the installed app or requiring access to a signing private key.
func TestSignedReleaseFixture(t *testing.T) {
	fixture := os.Getenv("FASTFILEVIEWER_UPDATE_TEST_APP")
	if fixture == "" {
		t.Skip("set FASTFILEVIEWER_UPDATE_TEST_APP to validate a signed release bundle")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	team, identifier, err := bundleIdentity(ctx, fixture)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(fixture, "Contents", "Resources", "build-metadata.json"))
	if err != nil {
		t.Fatal(err)
	}
	var metadata struct {
		Tag string `json:"tag"`
	}
	if json.Unmarshal(data, &metadata) != nil || metadata.Tag == "" {
		t.Fatal("missing release tag")
	}
	if err := verifyBundle(ctx, fixture, team, identifier, metadata.Tag); err != nil {
		t.Fatalf("official bundle rejected: %v", err)
	}
	if err := verifyBundle(ctx, fixture, strings.Repeat("X", 10), identifier, metadata.Tag); err == nil {
		t.Fatal("another publisher accepted")
	}
	if err := verifyBundle(ctx, fixture, team, identifier, "1.26.0101-build-0000"); err == nil {
		t.Fatal("wrong release accepted")
	}
}

// Exercise the actual signed helper and WebKit readiness handshake. Checking the
// downloaded app alone cannot detect a helper that macOS refuses to execute.
func TestSignedInstallerLaunchFixture(t *testing.T) {
	fixture := os.Getenv("FASTFILEVIEWER_UPDATE_TEST_APP")
	if fixture == "" {
		t.Skip("set FASTFILEVIEWER_UPDATE_TEST_APP to validate the signed installer")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(parent, "Installed.app")
	if output, err := command(ctx, "/usr/bin/ditto", "--noqtn", fixture, target); err != nil {
		t.Fatalf("copy fixture: %v: %s", err, output)
	}
	team, identifier, err := bundleIdentity(ctx, target)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(target, "Contents", "Resources", "build-metadata.json"))
	if err != nil {
		t.Fatal(err)
	}
	var release Release
	if err := json.Unmarshal(data, &release); err != nil || release.Tag == "" {
		t.Fatal("missing release metadata")
	}
	root, err := os.MkdirTemp(parent, stagingPrefix)
	if err != nil {
		t.Fatal(err)
	}
	job := installJob{Root: root, Target: target, ParentPID: os.Getpid(), Team: team, BundleID: identifier, Release: release, Locale: "en"}
	if err := copyInstaller(ctx, job); err != nil {
		t.Fatalf("prepare signed installer: %v", err)
	}
	if err := verifyBundle(ctx, filepath.Join(root, installerBundleName), team, identifier, release.Tag); err != nil {
		t.Fatalf("copied installer rejected: %v", err)
	}
	payload, err := json.Marshal(job)
	if err != nil {
		t.Fatal(err)
	}
	jobPath := filepath.Join(root, "job.json")
	if err := os.WriteFile(jobPath, payload, 0600); err != nil {
		t.Fatal(err)
	}
	cmd := detachedCommand(filepath.Join(root, installerBundleName, "Contents", "MacOS", "FastFileViewer"), helperFlag, jobPath)
	var output limitedOutput
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(exited) }()
	stop := func() {
		_ = cmd.Process.Kill()
		<-exited
	}
	defer stop()
	if err := waitForFile(ctx, filepath.Join(root, "ready"), exited, 20*time.Second); err != nil {
		stop()
		t.Fatalf("installer did not render and acknowledge readiness: %v: %s", err, output.data)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("installed fixture changed before parent exit: %v", err)
	}
	if _, err := os.Lstat(job.backup()); !os.IsNotExist(err) {
		t.Fatal("installer replaced the app before parent exit")
	}
}

func TestInstallerPreparationRefusesExistingBundle(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(root, installerBundleName)
	if err := os.Mkdir(destination, 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(destination, "keep")
	if err := os.WriteFile(marker, []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := copyInstaller(context.Background(), installJob{Root: root, Target: "missing.app"}); err == nil {
		t.Fatal("overwrote an existing installer")
	}
	if data, err := os.ReadFile(marker); err != nil || string(data) != "existing" {
		t.Fatal("existing installer contents changed")
	}
}

func TestInstallerLaunchReportsRestartFailure(t *testing.T) {
	if err := LaunchInstaller(context.Background(), t.TempDir()); err == nil || err.Error() != "restart" {
		t.Fatalf("wanted installer startup error, got %v", err)
	}
}
