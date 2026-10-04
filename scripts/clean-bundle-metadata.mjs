#!/usr/bin/env node
import { closeSync, constants, lstatSync, openSync, readSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [argument, ...extra] = process.argv.slice(2);
if (!argument || extra.length) throw new Error('Usage: clean-bundle-metadata.mjs APP_BUNDLE');
const bundle = resolve(argument);
if (!basename(bundle).endsWith('.app') || !lstatSync(bundle).isDirectory() || !lstatSync(join(bundle, 'Contents/MacOS')).isDirectory()) {
  throw new Error('Expected an application bundle');
}

const signature = Buffer.from([0, 5, 22, 7, 0, 2, 0, 0]);
const header = Buffer.alloc(8);
let removed = 0;
function clean(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    try {
      if (entry.isDirectory()) clean(path);
      else if (entry.isFile() && entry.name.startsWith('._')) {
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let length;
        try { length = readSync(fd, header, 0, header.length, 0); }
        finally { closeSync(fd); }
        // Preserve ordinary ._ files and never follow links outside the bundle.
        if (length === signature.length && header.equals(signature)) { unlinkSync(path); removed++; }
      }
    } catch (error) {
      // On macOS, removing metadata may also remove a previously listed entry.
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
clean(bundle);
console.log(`Removed ${removed} AppleDouble metadata files before signing.`);
