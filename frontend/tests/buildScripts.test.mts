import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const build = readFileSync(new URL('../../build.sh', import.meta.url), 'utf8');
const validation = build.slice(build.indexOf('validate_bundled_ffmpeg() {'), build.indexOf('prepare_bundled_ffmpeg() {'));
const macOS = process.platform === 'darwin';

for (const scenario of ['valid', 'failed', 'missing-configuration', 'wrong-tool', 'gpl']) {
  test('FFmpeg preflight: ' + scenario, { skip: !macOS }, () => {
    const root = mkdtempSync(join(tmpdir(), 'fastfileviewer-build-test-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      mkdirSync(join(root, 'lib'));
      writeFileSync(join(root, 'lib', 'libtest.dylib'), 'fixture');
      for (const license of ['ffmpeg/COPYING.LGPLv2.1', 'opus/COPYING', 'libvpx/LICENSE']) {
        const path = join(root, 'share/licenses', license);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, 'license fixture');
      }
      for (const tool of ['ffmpeg', 'ffprobe']) {
        let output = tool + ' version test\nconfiguration: --disable-gpl\n';
        if (scenario === 'missing-configuration') output = tool + ' version test\n';
        if (scenario === 'wrong-tool') output = 'wrong executable\nconfiguration: --disable-gpl\n';
        if (scenario === 'gpl') output = tool + ' version test\nconfiguration: --enable-gpl\n';
        const script = '#!/bin/zsh\nprintf "%s" ' + "'" + output + "'\nexit " + (scenario === 'failed' ? '1' : '0') + '\n';
        writeFileSync(join(bin, tool), script, { mode: 0o700 });
      }
      const result = spawnSync('/bin/zsh', ['-c', 'set -euo pipefail\n' + validation + '\nvalidate_bundled_ffmpeg'], {
        encoding: 'utf8', env: { ...process.env, FFMPEG_BIN_DIR: bin }, timeout: 5000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, scenario === 'valid' ? 0 : 1, result.stdout + result.stderr);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test('FFmpeg packaging preserves the ABI install name behind versioned library links', { skip: !macOS }, () => {
  const root = mkdtempSync(join(tmpdir(), 'fastfileviewer-codec-abi-'));
  const run = (command: string, args: string[], env = process.env) => {
    const result = spawnSync(command, args, { encoding: 'utf8', env, timeout: 15000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  try {
    const source = join(root, 'source');
    const app = join(root, 'Fixture.app');
    const licenses = join(app, 'Contents/Resources/Licenses');
    for (const dir of ['bin', 'lib', 'share/licenses/ffmpeg', 'share/licenses/opus', 'share/licenses/libvpx']) {
      mkdirSync(join(source, dir), { recursive: true });
    }
    mkdirSync(licenses, { recursive: true });
    for (const name of ['ffmpeg/COPYING.LGPLv2.1', 'opus/COPYING', 'libvpx/LICENSE']) {
      writeFileSync(join(source, 'share/licenses', name), 'license fixture');
    }
    writeFileSync(join(root, 'library.c'), 'int codec_fixture(void) { return 42; }\n');
    writeFileSync(join(root, 'main.c'), 'int codec_fixture(void); int main(void) { return codec_fixture() == 42 ? 0 : 1; }\n');
    const libraryName = 'libfixture.1.2.dylib';
    const abiName = 'libfixture.1.dylib';
    run('/usr/bin/clang', ['-dynamiclib', join(root, 'library.c'), '-o', join(source, 'lib', libraryName), '-Wl,-install_name,@rpath/' + abiName]);
    symlinkSync(libraryName, join(source, 'lib', abiName));
    for (const tool of ['ffmpeg', 'ffprobe']) {
      run('/usr/bin/clang', [join(root, 'main.c'), join(source, 'lib', abiName), '-Wl,-rpath,@executable_path/../lib', '-o', join(source, 'bin', tool)]);
    }
    const preparation = build.slice(build.indexOf('prepare_bundled_ffmpeg() {'), build.indexOf('\nrequired_commands='));
    run('/bin/zsh', ['-c', 'set -euo pipefail\n' + preparation + '\nprepare_bundled_ffmpeg'], {
      ...process.env, FFMPEG_BIN_DIR: join(source, 'bin'), BUILD_APP_PATH: app, APP_LICENSE_DIR: licenses,
    });
    const bundledLibrary = join(app, 'Contents/Resources/lib', libraryName);
    const installName = run('/usr/bin/otool', ['-D', bundledLibrary]).trim().split('\n')[1];
    assert.equal(installName, '@rpath/' + abiName);
    run('/usr/bin/codesign', ['--force', '--sign', '-', bundledLibrary]);
    for (const tool of ['ffmpeg', 'ffprobe']) {
      const executable = join(app, 'Contents/Resources/bin', tool);
      assert.match(run('/usr/bin/otool', ['-L', executable]), /@rpath\/libfixture\.1\.dylib/);
      run('/usr/bin/codesign', ['--force', '--sign', '-', executable]);
      run(executable, []);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
