#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function minimumMacOS(loadCommands) {
  const versions = [];
  for (const command of loadCommands.split(/Load command \d+/)) {
    if (/\bcmd LC_BUILD_VERSION\b/.test(command)) {
      if (!/\bplatform (?:1|MACOS)\b/.test(command)) continue;
      const match = command.match(/\bminos (\d+(?:\.\d+){0,2})\b/);
      if (match) versions.push(match[1]);
    } else if (/\bcmd LC_VERSION_MIN_MACOSX\b/.test(command)) {
      const match = command.match(/\bversion (\d+(?:\.\d+){0,2})\b/);
      if (match) versions.push(match[1]);
    }
  }
  if (versions.length !== 1) throw new Error('Expected one macOS minimum-version command');
  return versions[0];
}

export function supportsMacOS12(version) {
  const [major, minor = 0, patch = 0] = version.split('.').map(Number);
  return major < 12 || (major === 12 && minor === 0 && patch === 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('Usage: check-macos-target.mjs <Mach-O files...>');
  for (const file of files) {
    const output = execFileSync('otool', ['-arch', 'arm64', '-l', file], { encoding: 'utf8' });
    const version = minimumMacOS(output);
    if (!supportsMacOS12(version)) throw new Error(`macOS ${version} dependency exceeds macOS 12 target: ${file}`);
  }
  console.log(`Verified macOS 12 arm64 compatibility metadata for ${files.length} binaries.`);
}
