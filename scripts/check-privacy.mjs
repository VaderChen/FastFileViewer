#!/usr/bin/env node
// Deliberately dependency-free: usable from a Git hook and before packaging.
import { spawn, execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, opendir, readlink } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';

const CHUNK_BYTES = 64 * 1024;
const OVERLAP_BYTES = 512;
const MAX_FINDINGS = 1000;
const rules = [
  ['personal-path', /\/(?:Users|home)\/[^\s/\\<>{}$\[\]"'`*]+/g],
  ['personal-path', /\/Volumes\/[^\r\n\t/\\<>{}$\[\]"'`*]+/g],
  ['personal-path', /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\s/\\<>{}$\[\]"'`*]+/gi],
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/g],
  ['openai-token', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['stripe-secret', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g],
  ['credential-url', /\b(?:https?|ftp):\/\/[^\s/:@]+:[^\s/@]+@/gi],
];

let files = 0;
let skippedLinks = 0;
let findings = 0;

function fail(message) {
  const error = new Error(message);
  error.privacyMessage = message;
  throw error;
}

function git(args, root = process.cwd()) {
  try {
    return execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  } catch {
    fail('Cannot read Git metadata; run this command inside a Git repository.');
  }
}

async function scan(stream, label) {
  files += 1;
  let carry = '';
  let newlines = 0;
  const reported = new Set();
  for await (const chunk of stream) {
    // Latin-1 preserves every byte and lets ASCII credentials in binaries be scanned too.
    const current = Buffer.isBuffer(chunk) ? chunk.toString('latin1') : Buffer.from(chunk).toString('latin1');
    const text = carry + current;
    const firstLine = newlines - (carry.match(/\n/g)?.length ?? 0) + 1;
    for (const [category, pattern] of rules) {
      pattern.lastIndex = 0;
      for (let match; (match = pattern.exec(text));) {
        const line = firstLine + (text.slice(0, match.index).match(/\n/g)?.length ?? 0);
        const key = category + ':' + line;
        if (reported.has(key)) continue;
        reported.add(key);
        findings += 1;
        console.error(JSON.stringify(label) + ':' + line + ': ' + category);
        if (findings >= MAX_FINDINGS) fail('Finding limit reached; fix the reported files and scan again.');
      }
    }
    newlines += current.match(/\n/g)?.length ?? 0;
    carry = text.slice(-OVERLAP_BYTES);
  }
}

async function scanFile(path, label, allowMissing = false, scanLinkTarget = false, rejectDiskImage = false) {
  let before;
  try { before = await lstat(path); }
  catch (error) {
    if (allowMissing && error.code === 'ENOENT') return;
    throw error;
  }
  if (before.isSymbolicLink()) {
    if (scanLinkTarget) await scan(Readable.from([Buffer.from(await readlink(path))]), label);
    else skippedLinks += 1;
    return;
  }
  if (!before.isFile()) return;
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.dev !== before.dev || actual.ino !== before.ino) fail('A file changed while opening it; retry the privacy check.');
    if (rejectDiskImage && actual.size >= 512) {
      const footer = Buffer.alloc(4);
      await handle.read(footer, 0, footer.length, actual.size - 512);
      if (footer.equals(Buffer.from('koly'))) fail('Disk images must be unpacked first; scan the extracted application directory.');
    }
    await scan(handle.createReadStream({ autoClose: false, highWaterMark: CHUNK_BYTES }), label);
  } finally { await handle.close(); }
}

async function scanIndex(root) {
  const entries = git(['ls-files', '--stage', '-z'], root).split('\0').filter(Boolean);
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    const [mode, oid, stage] = entry.slice(0, tab).split(' ');
    const label = entry.slice(tab + 1);
    if (stage !== '0') fail('The Git index has unresolved conflicts.');
    if (mode === '160000') fail('Submodule contents need a separate privacy check.');
    const child = spawn('git', ['cat-file', 'blob', oid], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    // Install listeners before consuming stdout, including very small blobs.
    const completion = new Promise((done) => {
      child.once('error', () => done(false));
      child.once('close', (code) => done(code === 0));
    });
    try { await scan(child.stdout, label); }
    catch (error) { child.kill(); await completion; throw error; }
    if (!await completion) fail('Cannot read a staged Git blob.');
  }
}

async function scanArtifact(path, root) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) { skippedLinks += 1; return; }
  if (info.isDirectory()) {
    for await (const entry of await opendir(path)) {
      await scanArtifact(resolve(path, entry.name), root);
    }
    return;
  }
  if (!info.isFile()) return;
  if (['.dmg', '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.tar'].includes(extname(path).toLowerCase())) {
    fail('Compressed artifacts must be unpacked first; scan the extracted application directory.');
  }
  await scanFile(path, relative(root, path) || basename(path), false, false, true);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--artifact' && args.length === 2) {
    const target = resolve(args[1]);
    const info = await lstat(target);
    await scanArtifact(target, info.isDirectory() ? target : dirname(target));
  } else if (args.length === 0 || (args.length === 1 && args[0] === '--staged')) {
    const root = git(['rev-parse', '--show-toplevel']).trim();
    if (args[0] === '--staged') await scanIndex(root);
    else {
      const names = new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root).split('\0').filter(Boolean));
      for (const name of names) await scanFile(resolve(root, name), name, true, true);
    }
  } else {
    fail('Usage: node scripts/check-privacy.mjs [--staged | --artifact PATH]');
  }
  console.log('Privacy check: ' + files + ' files, ' + findings + ' findings, ' + skippedLinks + ' symlinks skipped.');
  process.exitCode = findings ? 1 : 0;
}

main().catch((error) => {
  // File-system and process errors can contain personal paths or input values.
  console.error(error.privacyMessage ?? ('Privacy check failed (' + (error.code ?? 'scan error') + ').'));
  process.exitCode = 2;
});
