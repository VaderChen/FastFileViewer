import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const checker = fileURLToPath(new URL('../../scripts/check-privacy.mjs', import.meta.url));
const privatePath = ['', 'Users', 'private-person', 'private-folder'].join('/');
const token = ['gh', 'p_', 'Ab9'.repeat(14)].join('');

function temporary(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'ffv-privacy-check-'));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
}

function check(root: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [checker, ...args], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.ok(!result.stdout.includes(privatePath) && !result.stderr.includes(privatePath), 'must not print personal paths');
  assert.ok(!result.stdout.includes(token) && !result.stderr.includes(token), 'must not print credentials');
  assert.ok(!result.stdout.includes(root) && !result.stderr.includes(root), 'must not print absolute scan roots');
  return result;
}

test('privacy check reads staged blobs even after the working tree is fixed, and ignores staged deletion', () => temporary((root) => {
  git(root, 'init', '-q');
  writeFileSync(join(root, 'example.txt'), 'first line\n' + privatePath + '\n' + token);
  git(root, 'add', 'example.txt');
  writeFileSync(join(root, 'example.txt'), 'safe content');
  assert.equal(check(root).status, 0);
  const staged = check(root, '--staged');
  assert.equal(staged.status, 1);
  assert.match(staged.stderr, /example\.txt.*:2: personal-path/);
  assert.match(staged.stderr, /example\.txt.*:3: github-token/);
  git(root, 'rm', '--cached', '-f', 'example.txt');
  assert.equal(check(root, '--staged').status, 0);
}));

test('privacy check includes untracked files but respects ignore rules and accepts attribution emails', () => temporary((root) => {
  git(root, 'init', '-q');
  writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(root, 'ignored.txt'), token);
  writeFileSync(join(root, 'credits.txt'), 'author@example.org\n123+public@users.noreply.github.com');
  assert.equal(check(root).status, 0);
  writeFileSync(join(root, 'new-file.txt'), privatePath);
  assert.equal(check(root).status, 1);
}));

test('privacy artifact check traverses nested binary content, including chunk boundaries, without following symlinks', () => temporary((root) => {
  const app = join(root, 'Viewer.app');
  const resources = join(app, 'Contents', 'Resources');
  mkdirSync(resources, { recursive: true });
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), token);
  symlinkSync(outside, join(resources, 'linked'), 'dir');
  symlinkSync(join(outside, 'secret.txt'), join(resources, 'linked-file'));
  assert.equal(check(root, '--artifact', app).status, 0);
  writeFileSync(join(resources, 'binary'), Buffer.concat([Buffer.alloc(65531), Buffer.from(privatePath), Buffer.from('\n' + token)]));
  const result = check(root, '--artifact', app);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Contents\/Resources\/binary.*personal-path/);
  assert.match(result.stderr, /github-token/);
}));

test('privacy artifact check rejects compressed packages and hides filesystem error paths', () => temporary((root) => {
  const dmg = join(root, 'Viewer.dmg');
  writeFileSync(dmg, 'compressed fixture');
  const result = check(root, '--artifact', dmg);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unpacked first/);
  const renamedImage = join(root, 'renamed-image.bin');
  const imageData = Buffer.alloc(1024);
  imageData.write('koly', imageData.length - 512);
  writeFileSync(renamedImage, imageData);
  const renamed = check(root, '--artifact', renamedImage);
  assert.equal(renamed.status, 2);
  assert.match(renamed.stderr, /unpacked first/);
  const absent = check(root, '--artifact', join(root, 'does-not-exist'));
  assert.equal(absent.status, 2);
  assert.match(absent.stderr, /ENOENT/);
}));

test('privacy check scans repository symlink targets as Git content without opening the target', () => temporary((root) => {
  git(root, 'init', '-q');
  symlinkSync(privatePath, join(root, 'linked-path'));
  assert.equal(check(root).status, 1);
  git(root, 'add', 'linked-path');
  rmSync(join(root, 'linked-path'));
  symlinkSync('safe-relative-path', join(root, 'linked-path'));
  assert.equal(check(root).status, 0);
  assert.equal(check(root, '--staged').status, 1);
}));

test('privacy check identifies Unix volume paths, Windows user paths and private key headers without printing values', () => temporary((root) => {
  git(root, 'init', '-q');
  const values = [
    ['', 'Volumes', 'Private Disk', 'collection'].join('/'),
    ['', 'home', 'private-person', 'collection'].join('/'),
    ['C:', 'Users', 'private-person', 'collection'].join('\\'),
    ['-----BEGIN ', 'OPENSSH ', 'PRIVATE KEY-----'].join(''),
    ['sk-', 'proj-', 'aB9'.repeat(20)].join(''),
  ];
  writeFileSync(join(root, 'sensitive.txt'), values.join('\n'));
  const result = check(root);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.split('\n').filter((line) => line.includes('personal-path')).length, 3);
  assert.match(result.stderr, /private-key/);
  assert.match(result.stderr, /openai-token/);
  for (const value of values) assert.ok(!result.stderr.includes(value));
}));

test('privacy checker source and split synthetic fixtures do not trigger their own rules', () => temporary((root) => {
  git(root, 'init', '-q');
  writeFileSync(join(root, 'check-privacy.mjs'), readFileSync(checker));
  writeFileSync(join(root, 'privacy-check.test.mts'), readFileSync(fileURLToPath(import.meta.url)));
  assert.equal(check(root).status, 0);
}));
