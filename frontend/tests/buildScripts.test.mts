import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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
