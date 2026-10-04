import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('final bundle cleanup removes only AppleDouble metadata and stays inside the bundle', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'ffv-bundle-metadata-'));
  try {
    const app = join(root, 'App with spaces.app');
    const resources = join(app, 'Contents/Resources');
    mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
    mkdirSync(resources);
    const header = Buffer.from([0, 5, 22, 7, 0, 2, 0, 0]);
    const sidecar = join(resources, '._Info.plist');
    const ordinary = join(resources, '._ordinary');
    const short = join(resources, '._short');
    const payload = join(resources, 'payload');
    writeFileSync(sidecar, header);
    writeFileSync(ordinary, 'keep');
    writeFileSync(short, header.subarray(0, 7));
    writeFileSync(payload, header);
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, '._keep'), header);
    symlinkSync(outside, join(resources, 'external'));
    symlinkSync(join(outside, '._keep'), join(resources, '._link'));
    const script = new URL('../../scripts/clean-bundle-metadata.mjs', import.meta.url);
    const run = (path: string) => spawnSync(process.execPath, [fileURLToPath(script), path], { encoding: 'utf8' });
    const result = run(app);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(sidecar), false);
    assert.equal(readFileSync(ordinary, 'utf8'), 'keep');
    assert.deepEqual(readFileSync(short), header.subarray(0, 7));
    assert.deepEqual(readFileSync(payload), header);
    assert.deepEqual(readFileSync(join(outside, '._keep')), header);
    assert.equal(existsSync(join(resources, '._link')), true);
    assert.equal(run(app).status, 0, 'cleanup must be repeatable');
    const linkedApp = join(root, 'Linked.app');
    symlinkSync(app, linkedApp);
    assert.notEqual(run(linkedApp).status, 0, 'a symlink root must be rejected');
    assert.notEqual(run(root).status, 0, 'an arbitrary directory must be rejected');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Wails CLI preparation caches the fix, isolates upstream files, and rejects failed builds', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'ffv-wails-cli-test-'));
  try {
    const project = join(root, 'Project with spaces');
    const upstream = join(root, 'module-cache');
    const bin = join(root, 'bin');
    for (const path of [join(project, 'scripts/wailscompat'), join(upstream, 'pkg/commands/build'), bin]) {
      mkdirSync(path, { recursive: true });
    }
    const script = join(project, 'scripts/prepare-wails-cli.mjs');
    const helper = join(project, 'scripts/wailscompat/appledouble.go');
    copyFileSync(new URL('../../scripts/prepare-wails-cli.mjs', import.meta.url), script);
    copyFileSync(new URL('../../scripts/wailscompat/appledouble.go', import.meta.url), helper);
    const upstreamFile = join(upstream, 'pkg/commands/build/build.go');
    const source = '\t\tcmd := exec.Command("/usr/bin/codesign", "--force", "--deep", "--sign", "-", options.CompiledBinary)\n';
    writeFileSync(upstreamFile, source);
    writeFileSync(join(project, 'go.mod'), 'module fixture\ngo 1.26.6\n');
    const goMod = readFileSync(join(project, 'go.mod'), 'utf8');
    // Exercise the real preparation script and filesystem layout without
    // downloading or compiling the full Wails toolchain inside this unit test.
    writeFileSync(join(bin, 'go'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'mod' && args[1] === 'download') {
  console.log(JSON.stringify({ Dir: process.env.FFV_TEST_MODULE, Version: 'v2.13.0' }));
} else if (args[0] === 'build') {
  const overlay = args[args.indexOf('-overlay') + 1];
  const replacements = JSON.parse(fs.readFileSync(overlay)).Replace;
  const buildFile = Object.keys(replacements).find(p => p.endsWith('/build.go'));
  if (!buildFile || buildFile.startsWith(process.env.FFV_TEST_MODULE)) process.exit(7);
  if (buildFile !== path.join(process.cwd(), 'pkg/commands/build/build.go')) process.exit(6);
  const patched = fs.readFileSync(replacements[buildFile], 'utf8');
  if (patched.indexOf('cleanFFVBundleForSigning(') >= patched.indexOf('exec.Command(')) process.exit(8);
  const helpers = Object.keys(replacements).filter(p => p.endsWith('/ffv_appledouble.go'));
  if (helpers.length !== 1 || !fs.existsSync(replacements[helpers[0]])) process.exit(9);
  const output = args[args.indexOf('-o') + 1];
  fs.appendFileSync(process.env.FFV_TEST_LOG, JSON.stringify({ overlay, output }) + '\\n');
  fs.writeFileSync(output, '#!/bin/sh\\nexit 0\\n', { mode: 0o755 });
  if (process.env.FFV_TEST_FAIL === '1') process.exit(1);
} else process.exit(10);
`, { mode: 0o755 });
    const log = join(root, 'builds.jsonl');
    const run = (fail = false) => spawnSync(process.execPath, [script], {
      cwd: project, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH, FFV_TEST_MODULE: upstream,
        FFV_TEST_LOG: log, FFV_TEST_FAIL: fail ? '1' : '0' },
    });
    const first = run();
    assert.equal(first.error, undefined);
    assert.equal(first.status, 0, first.stderr);
    const firstBinary = first.stdout.trim();
    assert.ok(existsSync(firstBinary));
    const cached = run();
    assert.equal(cached.status, 0, cached.stderr);
    assert.equal(cached.stdout.trim(), firstBinary);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);

    writeFileSync(helper, readFileSync(helper, 'utf8') + '\n// Revised compatibility fix.\n');
    const failed = run(true);
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.ok(existsSync(firstBinary), 'a failed rebuild must preserve the previous cached CLI');
    const rebuilt = run();
    assert.equal(rebuilt.status, 0, rebuilt.stderr);
    assert.notEqual(rebuilt.stdout.trim(), firstBinary);
    assert.ok(existsSync(rebuilt.stdout.trim()));
    const builds = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(builds.length, 3);
    for (const build of builds) {
      assert.equal(existsSync(build.overlay), false, 'temporary source/overlay must be removed');
      assert.equal(existsSync(build.output), false, 'partial output must be removed');
    }
    assert.equal(readFileSync(upstreamFile, 'utf8'), source);
    assert.deepEqual(readdirSync(join(upstream, 'pkg/commands/build')), ['build.go']);
    assert.equal(readFileSync(join(project, 'go.mod'), 'utf8'), goMod);
    writeFileSync(upstreamFile, '// incompatible upstream signing implementation\n');
    const incompatible = run();
    assert.equal(incompatible.status, 1);
    assert.match(incompatible.stderr, /Wails 簽章流程已變更/);
    assert.equal(incompatible.stdout, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
