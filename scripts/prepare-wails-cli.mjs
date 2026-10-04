import { createHash } from 'node:crypto';
import { accessSync, constants, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptPath = fileURLToPath(import.meta.url);
const project = dirname(dirname(scriptPath));
const moduleName = 'github.com/wailsapp/wails/v2';

// Build the declared CLI with a small pre-signing fix, without editing go.mod,
// wails.json, or the shared Go module cache. All other Wails behavior is retained.
function prepareWailsCLI() {
  const module = JSON.parse(execFileSync('go', ['mod', 'download', '-json', moduleName], {
    cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  }));
  if (!module.Dir || !/^v[\w.+-]+$/.test(module.Version)) {
    throw new Error('無法取得 go.mod 指定的 Wails 原始碼。');
  }
  const upstreamFile = join(module.Dir, 'pkg/commands/build/build.go');
  const upstream = readFileSync(upstreamFile, 'utf8');
  const helper = join(project, 'scripts/wailscompat/appledouble.go');
  const signing = '\t\tcmd := exec.Command("/usr/bin/codesign", "--force", "--deep", "--sign", "-", options.CompiledBinary)';
  if (upstream.split(signing).length !== 2) {
    throw new Error('Wails 簽章流程已變更，請先更新 scripts/prepare-wails-cli.mjs。');
  }
  const fingerprint = createHash('sha256').update(module.Version).update(upstream)
    .update(readFileSync(helper)).update(readFileSync(scriptPath))
    .update(process.platform).update(process.arch)
    .update(process.env.GOTOOLCHAIN || '').digest('hex').slice(0, 16);
  const toolDir = join(project, 'build/tools', module.Version, 'signing-' + fingerprint);
  const binary = join(toolDir, process.platform === 'win32' ? 'wails.exe' : 'wails');
  try {
    accessSync(binary, constants.X_OK);
    return binary;
  } catch { /* Compile once per Wails version and compatibility fix. */ }

  console.error(`準備專案指定的 Wails ${module.Version}（App 簽章相容修正）...`);
  // Go resolves its working directory; overlay keys must use the same physical
  // path (macOS temporary directories commonly pass through a symlink).
  const overlayDir = realpathSync(mkdtempSync(join(tmpdir(), 'fastfileviewer-wails-')));
  mkdirSync(toolDir, { recursive: true });
  const outputDir = mkdtempSync(join(toolDir, '.install-'));
  try {
    // Go prohibits overlays inside GOMODCACHE. Use a disposable source copy;
    // dependencies and normal compiler caches are still shared.
    const source = join(overlayDir, 'source');
    cpSync(module.Dir, source, { recursive: true });
    const sourceBuild = join(source, 'pkg/commands/build/build.go');
    const patched = join(overlayDir, 'build.go');
    const overlay = join(overlayDir, 'overlay.json');
    writeFileSync(patched, upstream.replace(signing, [
      '\t\tif options.Pack {',
      '\t\t\tif err := cleanFFVBundleForSigning(options.CompiledBinary); err != nil {',
      '\t\t\t\treturn "", fmt.Errorf("prepare bundle for codesign: %w", err)',
      '\t\t\t}',
      '\t\t}', signing,
    ].join('\n')));
    writeFileSync(overlay, JSON.stringify({ Replace: {
      [sourceBuild]: patched,
      [join(dirname(sourceBuild), 'ffv_appledouble.go')]: helper,
    } }));
    const pendingBinary = join(outputDir, 'wails');
    execFileSync('go', ['build', '-mod=readonly', '-trimpath', '-overlay', overlay,
      '-o', pendingBinary, './cmd/wails'], {
      cwd: source, stdio: ['ignore', 'inherit', 'inherit'],
    });
    renameSync(pendingBinary, binary);
    return binary;
  } finally {
    rmSync(overlayDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
}

try {
  process.stdout.write(prepareWailsCLI() + '\n');
} catch (error) {
  console.error('無法準備 Wails CLI：', error.message);
  process.exitCode = 1;
}
