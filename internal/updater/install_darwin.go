package updater

import (
	"context"
	"debug/macho"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

var identityPattern = regexp.MustCompile(`^[A-Za-z0-9.-]+$`)

type limitedOutput struct{ data []byte }

func (b *limitedOutput) Write(p []byte) (int, error) {
	n := len(p)
	if remaining := (64 << 10) - len(b.data); remaining > 0 {
		b.data = append(b.data, p[:min(len(p), remaining)]...)
	}
	return n, nil
}

func command(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var output limitedOutput
	cmd.Stdout, cmd.Stderr = &output, &output
	err := cmd.Run()
	return strings.TrimSpace(string(output.data)), err
}

func bundlePath() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", errors.New("unsupported")
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil || filepath.Base(filepath.Dir(executable)) != "MacOS" || filepath.Base(filepath.Dir(filepath.Dir(executable))) != "Contents" {
		return "", errors.New("unsupported")
	}
	target := filepath.Dir(filepath.Dir(filepath.Dir(executable)))
	if filepath.Ext(target) != ".app" || strings.Contains(target, "/AppTranslocation/") {
		return "", errors.New("not_writable")
	}
	return target, nil
}

func bundleIdentity(ctx context.Context, target string) (string, string, error) {
	output, err := command(ctx, "/usr/bin/codesign", "-d", "--verbose=4", target)
	if err != nil || !strings.Contains(output, "Authority=Developer ID Application:") {
		return "", "", errors.New("unsupported")
	}
	var team, identifier string
	for _, line := range strings.Split(output, "\n") {
		if value, ok := strings.CutPrefix(line, "TeamIdentifier="); ok {
			team = value
		}
		if value, ok := strings.CutPrefix(line, "Identifier="); ok {
			identifier = value
		}
	}
	if !identityPattern.MatchString(team) || team == "not set" || !identityPattern.MatchString(identifier) {
		return "", "", errors.New("unsupported")
	}
	return team, identifier, nil
}

func Capability(ctx context.Context) error {
	target, err := bundlePath()
	if err != nil {
		return err
	}
	if _, _, err = bundleIdentity(ctx, target); err != nil {
		return err
	}
	// A successful sibling mkdir tests both read-only volumes and install permissions.
	probe, err := os.MkdirTemp(filepath.Dir(target), stagingPrefix)
	if err != nil {
		return errors.New("not_writable")
	}
	return os.Remove(probe)
}

func verifyBundle(ctx context.Context, path, team, identifier, tag string) error {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() {
		return errors.New("signature")
	}
	requirement := fmt.Sprintf(`anchor apple generic and identifier %q and certificate leaf[subject.OU] = %q`, identifier, team)
	if _, err := command(ctx, "/usr/bin/codesign", "--verify", "--deep", "--strict", "-R", "="+requirement, path); err != nil {
		return errors.New("signature")
	}
	if tag == "" {
		return nil
	}
	if _, err := command(ctx, "/usr/sbin/spctl", "--assess", "--type", "execute", path); err != nil {
		return errors.New("signature")
	}
	executable := filepath.Join(path, "Contents", "MacOS", "FastFileViewer")
	file, err := macho.Open(executable)
	if err != nil {
		return errors.New("unsupported")
	}
	arm64 := file.Cpu == macho.CpuArm64
	file.Close()
	if !arm64 {
		return errors.New("unsupported")
	}
	metadataFile, err := os.Open(filepath.Join(path, "Contents", "Resources", "build-metadata.json"))
	if err != nil {
		return errors.New("invalid_release")
	}
	defer metadataFile.Close()
	var metadata struct {
		Tag string `json:"tag"`
	}
	if json.NewDecoder(io.LimitReader(metadataFile, 64<<10)).Decode(&metadata) != nil || metadata.Tag != tag {
		return errors.New("invalid_release")
	}
	minimum, err := command(ctx, "/usr/libexec/PlistBuddy", "-c", "Print :LSMinimumSystemVersion", filepath.Join(path, "Contents", "Info.plist"))
	if err != nil {
		return errors.New("unsupported")
	}
	current, err := command(ctx, "/usr/bin/sw_vers", "-productVersion")
	if err != nil || !systemVersionAtLeast(current, minimum) {
		return errors.New("system_version")
	}
	return nil
}

// Prepare performs all expensive and cancellable work while the main window stays open.
// The returned cleanup belongs to the caller until LaunchInstaller succeeds.
func Prepare(ctx context.Context, client *Client, release Release, locale string, progress func(string, int64)) (result string, cleanup func(), resultErr error) {
	noop := func() {}
	target, err := bundlePath()
	if err != nil {
		return "", noop, err
	}
	team, identifier, err := bundleIdentity(ctx, target)
	if err != nil {
		return "", noop, err
	}
	root, err := os.MkdirTemp(filepath.Dir(target), stagingPrefix)
	if err != nil {
		return "", noop, errors.New("not_writable")
	}
	mount := filepath.Join(root, "volume")
	cleanup = func() {
		// Never traverse a still-mounted image if the system could not detach it.
		if !volumeMounted(root, mount) {
			_ = os.RemoveAll(root)
		}
	}
	job := installJob{Root: root, Target: target, ParentPID: os.Getpid(), Team: team, BundleID: identifier,
		Release: Release{Tag: release.Tag, Version: release.Version}, Locale: locale}
	dmg := filepath.Join(root, "update.dmg")
	if err := client.Download(ctx, release, dmg, func(bytes int64) { progress("downloading", bytes) }); err != nil {
		return "", cleanup, err
	}
	progress("verifying", release.Size)
	if err := os.Mkdir(mount, 0700); err != nil {
		return "", cleanup, err
	}
	defer func() {
		detachContext, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if _, err := command(detachContext, "/usr/bin/hdiutil", "detach", mount); err != nil {
			_, _ = command(detachContext, "/usr/bin/hdiutil", "detach", "-force", mount)
		}
		if volumeMounted(root, mount) {
			resultErr = errors.New("install")
		}
	}()
	if _, err := command(ctx, "/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, dmg); err != nil {
		return "", cleanup, errors.New("install")
	}
	source := filepath.Join(mount, "FastFileViewer.app")
	if err := verifyBundle(ctx, source, team, identifier, release.Tag); err != nil {
		return "", cleanup, err
	}
	progress("preparing", release.Size)
	if _, err := command(ctx, "/usr/bin/ditto", source, job.staged()); err != nil {
		return "", cleanup, errors.New("install")
	}
	if err := verifyBundle(ctx, job.staged(), team, identifier, release.Tag); err != nil {
		return "", cleanup, err
	}
	if err := copyInstaller(filepath.Join(root, "installer")); err != nil {
		return "", cleanup, err
	}
	payload, err := json.Marshal(job)
	if err == nil {
		err = os.WriteFile(filepath.Join(root, "job.json"), payload, 0600)
	}
	return root, cleanup, err
}

func volumeMounted(root, mount string) bool {
	var rootInfo, mountInfo unix.Statfs_t
	if unix.Statfs(mount, &mountInfo) != nil {
		return false
	}
	if unix.Statfs(root, &rootInfo) != nil {
		return true
	}
	return rootInfo.Fsid != mountInfo.Fsid
}

func copyInstaller(destination string) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	source, err := os.Open(executable)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if err != nil {
		return err
	}
	_, err = io.Copy(target, source)
	closeErr := target.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func detachedCommand(path string, args ...string) *exec.Cmd {
	cmd := exec.Command(path, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return cmd
}

func LaunchInstaller(ctx context.Context, root string) error {
	cmd := detachedCommand(filepath.Join(root, "installer"), helperFlag, filepath.Join(root, "job.json"))
	if err := cmd.Start(); err != nil {
		return errors.New("install")
	}
	exited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(exited) }()
	if err := waitForFile(ctx, filepath.Join(root, "ready"), exited, 30*time.Second); err != nil {
		_ = cmd.Process.Kill()
		return errors.New("install")
	}
	return nil
}

func waitForFile(ctx context.Context, path string, exited <-chan struct{}, limit time.Duration) error {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(limit)
	defer timeout.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timeout.C:
			return errors.New("restart timeout")
		case <-exited:
			return errors.New("process exited before ready")
		case <-ticker.C:
			if info, err := os.Lstat(path); err == nil && info.Mode().IsRegular() {
				select {
				case <-exited:
					return errors.New("process exited before ready")
				default:
					return nil
				}
			}
		}
	}
}

func renameExclusive(from, to string) error { return unix.RenamexNp(from, to, unix.RENAME_EXCL) }

func launchUpdated(ctx context.Context, target, receipt string) error {
	cmd := detachedCommand(filepath.Join(target, "Contents", "MacOS", "FastFileViewer"), receiptFlag, receipt)
	if err := cmd.Start(); err != nil {
		return err
	}
	exited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(exited) }()
	if err := waitForFile(ctx, receipt, exited, 60*time.Second); err != nil {
		_ = cmd.Process.Kill()
		select {
		case <-exited:
		case <-time.After(5 * time.Second):
			return errNewProcessRunning
		}
		return err
	}
	return nil
}

func reopenApp(target string) error {
	cmd := detachedCommand(filepath.Join(target, "Contents", "MacOS", "FastFileViewer"))
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func AcknowledgeLaunch(arguments []string) {
	for i := 0; i+1 < len(arguments); i++ {
		if arguments[i] != receiptFlag {
			continue
		}
		target, err := bundlePath()
		root := filepath.Dir(arguments[i+1])
		if err != nil || filepath.Base(arguments[i+1]) != "started" ||
			!strings.HasPrefix(filepath.Base(root), stagingPrefix) || filepath.Dir(root) != filepath.Dir(target) {
			return
		}
		info, err := os.Lstat(root)
		if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
			return
		}
		file, err := os.OpenFile(arguments[i+1], os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err == nil {
			_ = file.Close()
		}
		return
	}
}
