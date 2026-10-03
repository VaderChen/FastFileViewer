import assert from 'node:assert/strict';
import test from 'node:test';
import { Component } from 'react';
import { parseDelimitedText } from '../src/structuredData.ts';
import { globalValue, hookHarness, loadSource } from './helpers/hookHarness.mts';
import type { ImageEntry } from '../src/types.ts';

function findElement(tree: any, match: (element: any) => boolean): any {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findElement(child, match);
      if (found) return found;
    }
    return undefined;
  }
  return match(tree) ? tree : findElement(tree.props?.children, match);
}

test('delimited parsing retains a final empty quoted record', () => {
  assert.deepEqual(parseDelimitedText('header\n""', ',').rows, [['header'], ['']]);
  assert.deepEqual(parseDelimitedText('""', '\t').rows, [['']]);
});

test('delimited parsing reports only actual omitted rows', () => {
  assert.deepEqual(parseDelimitedText('header\nvalue\n', ',', 2), {
    rows: [['header'], ['value']], truncated: false,
  });
  assert.equal(parseDelimitedText('header\nvalue', ',', 2).truncated, false);
  assert.equal(parseDelimitedText('header\nvalue\nextra', ',', 2).truncated, true);
  assert.deepEqual(parseDelimitedText('header', ',', 0), { rows: [], truncated: true });
});

test('delimited parsing caps columns, signals omission and preserves following records', () => {
  const columns = Array.from({ length: 100 }, (_, index) => String(index));
  const text = columns.join(',') + ',"omitted\ncell",ignored"quote\nnext,row';
  const parsed = parseDelimitedText(text, ',');
  assert.deepEqual(parsed.rows, [columns, ['next', 'row']]);
  assert.equal(parsed.truncated, true);
  assert.equal(parseDelimitedText(columns.join(','), ',').truncated, false);
});

test('delimited parsing preserves long cells, escapes and mixed line endings', () => {
  const value = 'x'.repeat(1000000);
  assert.deepEqual(parseDelimitedText('"' + value + '""end"\r\nplain,""\rtail,', ',').rows, [
    [value + '"end'], ['plain', ''], ['tail', ''],
  ]);
  assert.deepEqual(parseDelimitedText('start,"unterminated""quote', ',').rows, [['start', 'unterminated"quote']]);
});

test('delimited row preview warning follows the filtered result limit', () => {
  const harness = hookHarness();
  const { DelimitedTableView } = loadSource('structuredViewers.tsx', { ...harness.react, Component });
  const text = ['name', 'unique', ...Array.from({ length: 1200 }, () => 'other')].join('\n');
  const labels = { filterRows: 'Filter', rows: 'rows', columns: 'columns', truncated: 'Limited', noMatchingRows: 'Empty' };
  const render = () => harness.render(() => DelimitedTableView({ text, delimiter: ',', labels }));
  const initial = render();
  assert.ok(findElement(initial, (element) => element.props?.className === 'structured-warning'));
  findElement(initial, (element) => element.type === 'input').props.onChange({ target: { value: 'unique' } });
  const filtered = render();
  assert.equal(findElement(filtered, (element) => element.props?.className === 'structured-warning'), undefined);
  assert.ok(findElement(filtered, (element) => element.type === 'td' && element.props.children === 'unique'));
});

const image = (id: number): ImageEntry => ({
  id: String(id), name: String(id) + '.png', path: '/' + id + '.png', directoryPath: '/',
  source: 'file', format: '.png', kind: 'image', size: 1,
});

test('load-all progress is clamped when the current library shrinks', () => {
  const harness = hookHarness();
  const { useWorkspace } = loadSource('useWorkspace.ts', harness.react);
  const frames: (() => void)[] = [];
  const timers: (() => void)[] = [];
  const restore = globalValue('window', {
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame: () => undefined,
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
    clearTimeout: () => undefined,
  });
  try {
    let libraryImages = Array.from({ length: 10000 }, (_, index) => image(index));
    const render = () => harness.render(() => useWorkspace({ libraryImages, labels: { operationFailed: 'Failed' } }));
    render().loadAll();
    assert.equal(render().loadTarget, 10000);
    libraryImages = libraryImages.slice(0, 2);
    render();
    const advance = () => harness.effects.find((effect) => effect.deps?.length >= 2 && effect.deps[0] === 120)!.run();
    advance();
    let workspace = render();
    assert.equal(workspace.loadTarget, 2);
    advance();
    assert.equal(frames.length, 0);
    assert.equal(timers.length, 1);
    timers[0]();
    workspace = render();
    assert.equal(workspace.loadingMore, false);
    assert.equal(workspace.displayedImages.length, 2);
  } finally { restore(); }
});
