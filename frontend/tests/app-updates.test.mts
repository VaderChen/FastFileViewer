import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { flush, globalValue, hookHarness, loadSource } from './helpers/hookHarness.mts';
import { reconcileAppUpdateState, updatePercent, updateErrorMessage } from '../src/appUpdates.ts';
import type { AppUpdateState } from '../src/appUpdates.ts';

test('unchanged update snapshots retain identity and all dialog fields can change', () => {
  const previous = state('downloading', { release, bytes: 5 });
  assert.equal(reconcileAppUpdateState(previous, structuredClone(previous)), previous);
  for (const [field, value] of Object.entries(previous)) {
    if (field === 'release') continue;
    const next = { ...previous, [field]: typeof value === 'number' ? value + 1 : value + '-changed' };
    assert.equal(reconcileAppUpdateState(previous, next), next, field);
  }
  for (const [field, value] of Object.entries(release)) {
    const next = { ...previous, release: { ...release, [field]: typeof value === 'number' ? value + 1 : value + '-changed' } };
    assert.equal(reconcileAppUpdateState(previous, next), next, field);
  }
  const cleared = state('error', { error: 'network' });
  assert.equal(reconcileAppUpdateState(previous, cleared), cleared);
  assert.equal(reconcileAppUpdateState(cleared, previous), previous);
});

test('progress polling fetches release details once and keeps notes through installation', async () => {
  const app = harness();
  try {
    await flush(); const checking = app.render().state;
    await app.poll(); assert.equal(app.render().state, checking); assert.equal(app.calls.details, 0);
    app.setBackend(state('available', { release })); await app.poll();
    assert.equal(app.calls.details, 1);
    app.render().install(); await flush();
    const downloading = app.render().state;
    for (let i = 0; i < 5; i++) { await app.poll(); assert.equal(app.render().state, downloading); }
    app.setBackend(state('downloading', { release, bytes: 75 })); await app.poll();
    assert.equal(app.render().state.bytes, 75); assert.equal(app.render().state.release, downloading.release);
    app.setBackend(state('verifying', { release, bytes: 100 })); await app.poll();
    assert.equal(app.render().state.phase, 'verifying'); assert.equal(app.render().state.release.notes, release.notes);
    assert.equal(app.calls.details, 1);
    app.setBackend(state('error', { error: 'network' })); await app.poll();
    assert.equal(app.render().state.release, undefined); assert.equal(app.render().state.error, 'network');
    assert.equal(app.calls.details, 2); assert.equal(app.timers.size, 0);
  } finally { app.dispose(); }
});

test('a new manual check refreshes edited notes even when the tag stays the same', async () => {
  const app = harness();
  try {
    await flush(); app.setBackend(state('available', { release })); await app.poll();
    app.setBackend(state('available', { release: { ...release, notes: 'Updated notes' } }));
    app.render().check(); await flush();
    assert.equal(app.render().state.release.notes, 'Updated notes');
  } finally { app.dispose(); }
});

test('late release metadata cannot overwrite cancellation or remount state', async () => {
  const details = deferred<AppUpdateState>();
  const app = harness({ GetUpdateState: () => details.promise });
  try {
    await flush(); app.setBackend(state('available', { release }));
    const poll = app.timers.values().next().value!; app.timers.clear(); poll(); await flush();
    app.render().cancel(); await flush();
    details.resolve(state('available', { release })); await flush();
    assert.equal(app.render().state.phase, 'cancelled'); assert.equal(app.timers.size, 0);
  } finally { app.dispose(); }
});


const release = { tag: '1.26.1003-build-2200', version: '1.26.1003 build 2200', notes: 'Changes', url: 'https://github.com/VaderChen/FastFileViewer/releases/tag/1.26.1003-build-2200', size: 100 };
const state = (phase: AppUpdateState['phase'], extra = {}): AppUpdateState => ({ phase, currentVersion: '1.26.1003 build 2100', bytes: 0, error: '', installError: '', ...extra });
const progress = ({ release, ...snapshot }: AppUpdateState) => ({ ...snapshot, releaseTag: release?.tag ?? '' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }

function harness(overrides: Record<string, unknown> = {}) {
  const h = hookHarness();
  const timers = new Map<number, () => void>(); let timer = 0;
  const calls = { checks: 0, installs: 0, cancels: 0, ready: 0, details: 0, progress: 0 };
  let backend = state('checking');
  const api = {
    FrontendReady: async () => { calls.ready++; },
    CheckForUpdates: async () => { calls.checks++; return backend; },
    GetUpdateState: async () => { calls.details++; return backend; },
    GetUpdateProgress: async () => { calls.progress++; return progress(backend); },
    InstallUpdate: async () => { calls.installs++; backend = state('downloading', { release }); return backend; },
    CancelUpdate: async () => { calls.cancels++; backend = state('cancelled', { release }); return backend; },
    ...overrides,
  };
  const restore = globalValue('window', { go: { app: { UpdateService: api } },
    setTimeout: (run: () => void) => { timers.set(++timer, run); return timer; }, clearTimeout: (id: number) => timers.delete(id) });
  const { useAppUpdates } = loadSource('useAppUpdates.ts', h.react);
  const render = () => h.render(() => useAppUpdates('zh-TW'));
  render();
  const effect = h.effects[0];
  const cleanup = effect.run();
  return { render, calls, timers, effect, cleanup, setBackend: (value: AppUpdateState) => { backend = value; },
    async poll() { const run = timers.values().next().value; timers.clear(); assert.ok(run); run(); await flush(); },
    dispose() { cleanup?.(); restore(); },
  };
}

test('startup checks quietly, then prompts only when an update is available', async () => {
  const app = harness();
  try {
    await flush(); assert.equal(app.calls.ready, 1); assert.equal(app.calls.checks, 1); assert.equal(app.render().visible, false);
    app.setBackend(state('available', { release })); await app.poll();
    assert.equal(app.render().visible, true); assert.equal(app.render().state.release.version, release.version);
    app.render().dismiss(); assert.equal(app.render().visible, false); assert.equal(app.timers.size, 0);
    app.setBackend(state('current')); app.render().check(); await flush();
    assert.equal(app.render().visible, true); assert.equal(app.render().state.phase, 'current');
  } finally { app.dispose(); }
});

test('automatic failures stay quiet while manual failures remain visible', async () => {
  const app = harness({ CheckForUpdates: async () => { throw new Error('offline'); } });
  try {
    await flush(); assert.equal(app.render().visible, false); assert.equal(app.render().state.error, 'network');
    app.render().check(); await flush(); assert.equal(app.render().visible, true);
  } finally { app.dispose(); }
});

test('repeated update clicks start one request and cancellation stops polling', async () => {
  const app = harness();
  try {
    await flush(); app.setBackend(state('available', { release })); await app.poll();
    app.render().install(); app.render().install(); await flush();
    assert.equal(app.calls.installs, 1); assert.equal(app.render().busy, true);
    app.render().dismiss(); assert.equal(app.render().visible, true);
    app.render().cancel(); await flush();
    assert.equal(app.calls.cancels, 1); assert.equal(app.render().state.phase, 'cancelled'); assert.equal(app.timers.size, 0);
  } finally { app.dispose(); }
});

test('stale polling cannot overwrite an explicit cancel', async () => {
  const stale = deferred<ReturnType<typeof progress>>();
  const app = harness({ GetUpdateProgress: () => stale.promise });
  try {
    await flush(); const tick = app.timers.values().next().value!; app.timers.clear(); tick();
    app.render().cancel(); await flush(); stale.resolve(progress(state('downloading', { release }))); await flush();
    assert.equal(app.render().state.phase, 'cancelled'); assert.equal(app.timers.size, 0);
  } finally { app.dispose(); }
});

test('an update cannot be dismissed while its start request is pending', async () => {
  const pending = deferred<AppUpdateState>();
  const app = harness({ InstallUpdate: () => pending.promise });
  try {
    await flush(); app.setBackend(state('available', { release })); await app.poll();
    const before = app.render(); before.install(); before.dismiss();
    assert.equal(app.render().visible, true); assert.equal(app.render().state.phase, 'downloading');
    pending.resolve(state('downloading', { release })); await flush();
    assert.equal(app.render().visible, true);
  } finally { app.dispose(); }
});

test('unmount and StrictMode remount discard old check results and timers', async () => {
  const first = deferred<AppUpdateState>(); let count = 0;
  const app = harness({ CheckForUpdates: () => ++count === 1 ? first.promise : Promise.resolve(state('current')) });
  try {
    app.cleanup?.(); const secondCleanup = app.effect.run(); await flush();
    first.resolve(state('available', { release })); await flush();
    assert.equal(app.render().state.phase, 'current'); assert.equal(app.render().visible, false);
    secondCleanup?.(); assert.equal(app.timers.size, 0);
  } finally { app.dispose(); }
});

test('overall progress reserves installation steps and all locales explain failures', () => {
  assert.equal(updatePercent(state('downloading', { release, bytes: 50 })), 32);
  assert.equal(updatePercent(state('downloading', { release, bytes: 150 })), 65);
  assert.equal(updatePercent(state('verifying')), 65); assert.equal(updatePercent(state('preparing')), 70);
  assert.equal(updatePercent(state('restarting')), 80); assert.equal(updatePercent(state('checking')), undefined);
  for (const locale of ['zh-TW', 'en', 'ja'] as const) for (const error of ['network', 'checksum', 'signature', 'not_writable', 'system_version']) {
    assert.ok(updateErrorMessage(error, locale).length > 10);
  }
});

test('the update dialog escapes release notes and disables installation on unsupported apps', () => {
  const { AppUpdateDialog } = loadSource('AppUpdateDialog.tsx');
  const props = { locale: 'zh-TW', onInstall() {}, onCancel() {}, onClose() {} };
  const markup = renderToStaticMarkup(createElement(AppUpdateDialog, { ...props,
    state: state('available', { release: { ...release, notes: '<script>unsafe()</script>' }, installError: 'not_writable' }) }));
  assert.ok(markup.includes('role="dialog"')); assert.ok(markup.includes('&lt;script&gt;'));
  assert.ok(!markup.includes('<script>')); assert.ok(!markup.includes('更新並重新啟動'));
  const ready = renderToStaticMarkup(createElement(AppUpdateDialog, { ...props, state: state('available', { release }) }));
  assert.ok(ready.includes('更新並重新啟動'));
  const installing = renderToStaticMarkup(createElement(AppUpdateDialog, { ...props, state: state('restarting', { release }) }));
  assert.ok(installing.includes('value="80"')); assert.ok(!installing.includes('<button'));
});
