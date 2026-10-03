import assert from 'node:assert/strict';
import test from 'node:test';
import { minimumMacOS, supportsMacOS12 } from '../../scripts/check-macos-target.mjs';

test('macOS minimum-version parsing handles modern and legacy load commands', () => {
  assert.equal(minimumMacOS('Load command 9\n cmd LC_BUILD_VERSION\n platform 1\n minos 12.0\n sdk 27.0'), '12.0');
  assert.equal(minimumMacOS('Load command 2\n cmd LC_VERSION_MIN_MACOSX\n version 11.0\n sdk 14.0'), '11.0');
  assert.equal(minimumMacOS('Load command 9\n cmd LC_BUILD_VERSION\n platform MACOS\n minos 27.0'), '27.0');
});

test('packaging rejects dependencies requiring a newer macOS', () => {
  for (const version of ['11.0', '12', '12.0', '12.0.0']) assert.equal(supportsMacOS12(version), true);
  for (const version of ['12.0.1', '12.1', '13.0', '27.0']) assert.equal(supportsMacOS12(version), false);
});

test('missing, non-macOS, and ambiguous load commands fail validation', () => {
  assert.throws(() => minimumMacOS('Load command 1\n cmd LC_UUID'));
  assert.throws(() => minimumMacOS('Load command 1\n cmd LC_BUILD_VERSION\n platform 2\n minos 12.0'));
  assert.throws(() => minimumMacOS('Load command 1\n cmd LC_BUILD_VERSION\n platform 1\n minos 12.0\nLoad command 2\n cmd LC_VERSION_MIN_MACOSX\n version 12.0'));
});
