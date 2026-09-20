import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const build = readFileSync(new URL('../../scripts/build-ffmpeg-macos.sh', import.meta.url), 'utf8');
const macOS = process.platform === 'darwin';

const fixture = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const root = process.env.FFMPEG_TEST_ROOT;
if (name === 'uname') {
  process.stdout.write(args[0] === '-s' ? 'Darwin\\n' : 'arm64\\n');
} else if (name === 'sysctl') {
  process.stdout.write('2\\n');
} else if (name === 'pkg-config') {
  if (args[0] !== '--exists') process.stdout.write(path.join(root, 'dependencies') + '\\n');
} else if (name === 'curl') {
  const output = args[args.indexOf('--output') + 1];
  fs.writeFileSync(output, 'license fixture');
} else if (name === 'mv') {
  if (process.env.FFMPEG_TEST_FAIL_MOVE === '1' && args[0].endsWith('/fastfileviewer/ffmpeg')) process.exit(1);
  const moved = cp.spawnSync('/bin/mv', args, { stdio: 'inherit' });
  process.exit(moved.status ?? 1);
} else if (name === 'configure') {
  fs.writeFileSync(path.join(root, 'configure.json'), JSON.stringify(args));
  fs.writeFileSync(path.join(root, 'cppflags.txt'), process.env.CPPFLAGS || '');
  const source = path.join(process.cwd(), 'path.c');
  const executable = path.join(root, 'path-check');
  fs.writeFileSync(source, '#include <stdio.h>\\nint main(void) { puts(__FILE__); return 0; }\\n');
  const flags = (process.env.CPPFLAGS || '').trim().split(/\\s+/);
  const compiled = cp.spawnSync('/usr/bin/clang', [...flags, source, '-o', executable], { encoding: 'utf8' });
  if (compiled.status !== 0) { process.stderr.write(compiled.stderr || 'clang failed'); process.exit(1); }
  const run = cp.spawnSync(executable, [], { encoding: 'utf8' });
  if (run.status !== 0) process.exit(1);
  fs.writeFileSync(path.join(root, 'compiled-path.txt'), run.stdout);
} else if (name === 'make' && args[0] === 'install') {
  const destination = args.find(arg => arg.startsWith('DESTDIR='));
  if (!destination) { process.stderr.write('missing DESTDIR'); process.exit(1); }
  const stage = destination.slice('DESTDIR='.length);
  fs.writeFileSync(path.join(root, 'stage.txt'), stage);
  if (process.env.FFMPEG_TEST_FAIL_INSTALL === '1') process.exit(1);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'configure.json'), 'utf8'));
  const prefix = config.find(arg => arg.startsWith('--prefix=')).slice('--prefix='.length);
  const install = stage + prefix;
  fs.mkdirSync(path.join(install, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(install, 'lib'), { recursive: true });
  for (const tool of ['ffmpeg', 'ffprobe']) {
    fs.writeFileSync(path.join(install, 'bin', tool), '#!/bin/sh\\nexit 0\\n', { mode: 0o755 });
  }
  fs.writeFileSync(path.join(install, 'lib', 'libavutil.60.dylib'), 'library fixture');
}
`;

for (const scenario of ['success', 'install-failure', 'move-failure']) {
  test('FFmpeg staged build: ' + scenario, { skip: !macOS }, () => {
    const root = mkdtempSync(join(tmpdir(), 'fastfileviewer-ffmpeg-test-'));
    try {
      const project = join(root, 'project "with spaces"');
      const script = join(project, 'scripts', 'build-ffmpeg-macos.sh');
      const sourceRoot = join(root, 'source "with spaces"');
      const source = join(sourceRoot, 'ffmpeg-test');
      const prefix = join(project, 'custom install');
      const commands = join(root, 'commands');
      for (const path of [dirname(script), source, prefix, commands, join(root, 'dependencies')]) {
        mkdirSync(path, { recursive: true });
      }
      writeFileSync(script, build);
      writeFileSync(join(prefix, 'previous-install'), 'keep until build succeeds');
      writeFileSync(join(source, 'COPYING.LGPLv2.1'), 'LGPL fixture');
      for (const name of ['libopus.0.dylib', 'libvpx.12.dylib']) {
        writeFileSync(join(root, 'dependencies', name), 'dependency fixture');
      }
      writeFileSync(join(source, 'configure'), fixture, { mode: 0o755 });
      for (const name of ['uname', 'sysctl', 'pkg-config', 'curl', 'make', 'mv']) {
        writeFileSync(join(commands, name), fixture, { mode: 0o755 });
      }
      const result = spawnSync('/bin/zsh', [script], {
        encoding: 'utf8', timeout: 15000,
        env: {
          ...process.env, PATH: commands + ':' + process.env.PATH,
          FFMPEG_TEST_ROOT: root,
          FFMPEG_TEST_FAIL_INSTALL: scenario === 'install-failure' ? '1' : '0',
          FFMPEG_TEST_FAIL_MOVE: scenario === 'move-failure' ? '1' : '0',
          FFMPEG_VERSION: 'test', FFMPEG_SOURCE_ROOT: sourceRoot, FFMPEG_PREFIX: prefix,
          CPPFLAGS: '-DRETAIN_CONFIGURED_FLAG=1',
        },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, scenario === 'success' ? 0 : 1, result.stdout + result.stderr);
      const args = JSON.parse(readFileSync(join(root, 'configure.json'), 'utf8')) as string[];
      assert.ok(args.includes('--prefix=/fastfileviewer/ffmpeg'));
      assert.ok(args.includes('--install-name-dir=@rpath'));
      assert.ok(args.every(arg => !arg.includes(root)));
      assert.ok(!args.includes('--enable-gpl') && !args.includes('--enable-nonfree'));
      assert.match(readFileSync(join(root, 'cppflags.txt'), 'utf8'), /-DRETAIN_CONFIGURED_FLAG=1/);
      assert.equal(readFileSync(join(root, 'compiled-path.txt'), 'utf8').trim(), 'ffmpeg/path.c');
      assert.equal(existsSync(readFileSync(join(root, 'stage.txt'), 'utf8')), false);
      assert.equal(existsSync(prefix + '.bak'), false);
      assert.equal(existsSync(join(prefix, 'previous-install')), scenario !== 'success');
      if (scenario === 'success') {
        for (const file of ['bin/ffmpeg', 'bin/ffprobe', 'lib/libavutil.60.dylib', 'lib/libopus.0.dylib', 'lib/libvpx.12.dylib', 'share/licenses/ffmpeg/COPYING.LGPLv2.1', 'share/licenses/opus/COPYING', 'share/licenses/libvpx/LICENSE']) {
          assert.ok(existsSync(join(prefix, file)), file);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
