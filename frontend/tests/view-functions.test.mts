import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileVisibleSelection } from '../src/libraryView.ts';
import { hookHarness } from './helpers/hookHarness.mts';
import { loadCodeHighlight } from './helpers/codeHighlight.mts';
import type { ImageEntry } from '../src/types.ts';

test('visible selection keeps insertion order, new result identity and first-entry fallback', () => {
  const entries = ['first', 'second', 'third', 'first'].map(id => ({ id }) as ImageEntry);
  for (const ids of [[], ['missing'], ['third', 'first', 'missing'], ['second', 'third', 'first']]) {
    const selected = new Set(ids);
    const visible = new Set(entries.map(entry => entry.id));
    const expected = new Set(ids.filter(id => visible.has(id)));
    if (!expected.size) expected.add(entries[0].id);
    const result = reconcileVisibleSelection(entries, selected);
    assert.deepEqual([...result], [...expected]);
    assert.deepEqual([...selected], ids);
    assert.notEqual(result, selected);
  }
  assert.deepEqual([...reconcileVisibleSelection([], new Set(['old']))], []);
});

test('code highlighting is reused across label updates and recomputed for source or language changes', () => {
  const harness = hookHarness();
  const calls: unknown[] = [];
  const CodeHighlight = loadCodeHighlight(harness.react.useMemo, {
    getLanguage: () => true,
    highlight(code: string, options: unknown) { calls.push([code, options]); return { value: `<span>${code}</span>\n` }; },
  });
  const render = (code = 'first\r\nsecond\r', language = 'javascript', truncatedLabel = 'limit') => harness.render(() => CodeHighlight({ code, language, truncatedLabel }));
  const before = render();
  const after = render(undefined, undefined, '不同語言');
  assert.deepEqual(after, before);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['first\nsecond\n', { language: 'javascript', ignoreIllegals: true }]);
  render('changed');
  render('changed', 'typescript');
  assert.equal(calls.length, 3);
  render('plain <tag> & text', 'plaintext');
  assert.equal(calls.length, 3);
});

test('code preview memo remains bounded and does not preserve content across component lifetimes', () => {
  const calls: string[] = [];
  const highlighter = { getLanguage: () => true, highlight: (text: string) => { calls.push(text); return { value: text }; } };
  for (let lifetime = 0; lifetime < 2; lifetime++) {
    const harness = hookHarness();
    const CodeHighlight = loadCodeHighlight(harness.react.useMemo, highlighter);
    for (const label of ['limit', 'updated']) {
      const tree = harness.render(() => CodeHighlight({ code: 'x'.repeat(2_000_001), language: 'javascript', truncatedLabel: label }));
      assert.equal(tree.props.children[1].props.children, label);
    }
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every(text => text.length === 2_000_000));
});
