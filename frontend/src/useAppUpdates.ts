import { useEffect, useRef, useState } from 'react';
import type { LocaleCode } from './types';
import { reconcileAppUpdateState, updateBusy } from './appUpdates';
import type { AppUpdateAPI, AppUpdateState } from './appUpdates';

const idle: AppUpdateState = { phase: 'idle', currentVersion: '', bytes: 0, error: '', installError: '' };

export function useAppUpdates(locale: LocaleCode) {
  const [state, setState] = useState<AppUpdateState>(idle);
  const [visible, setVisible] = useState(false);
  const lifetime = useRef({ mounted: false, sequence: 0, timer: 0, pending: false });

  const request = async (action: (api: AppUpdateAPI) => Promise<AppUpdateState>, manual = false) => {
    const api = window.go?.app?.UpdateService;
    if (!lifetime.current.mounted) return;
    if (!api) {
      if (manual) { setVisible(true); setState(previous => ({ ...previous, phase: 'error', error: 'unsupported' })); }
      return;
    }
    const active = lifetime.current;
    const sequence = ++active.sequence;
    window.clearTimeout(active.timer);
    if (manual) setVisible(true);
    const current = () => active.mounted && active.sequence === sequence;
    try {
      const next = await action(api);
      if (!current()) return;
      setState(previous => reconcileAppUpdateState(previous, next));
      if (next.phase === 'available') setVisible(true);
      if (updateBusy(next.phase)) {
        active.timer = window.setTimeout(() => {
          void request(async service => {
            const { releaseTag, ...progress } = await service.GetUpdateProgress();
            // Release metadata is immutable during an operation. Fetch it once
            // when a check discovers a different release, then reuse it.
            if (releaseTag !== (next.release?.tag ?? '')) return service.GetUpdateState();
            return { ...progress, release: next.release };
          });
        }, 350);
      }
    } catch {
      if (current()) setState(previous => ({ ...previous, phase: 'error', error: 'network' }));
    }
  };

  useEffect(() => {
    const active = lifetime.current;
    active.mounted = true;
    void window.go?.app?.UpdateService?.FrontendReady().catch(() => undefined);
    void request(api => api.CheckForUpdates());
    return () => {
      active.mounted = false;
      active.sequence += 1;
      window.clearTimeout(active.timer);
    };
  }, []);

  const act = async (action: (api: AppUpdateAPI) => Promise<AppUpdateState>) => {
    if (lifetime.current.pending) return;
    lifetime.current.pending = true;
    try { await request(action, true); }
    finally { lifetime.current.pending = false; }
  };

  return {
    state, visible, busy: updateBusy(state.phase),
    check: () => {
      setState(previous => ({ ...previous, phase: 'checking', error: '' }));
      void act(api => api.CheckForUpdates());
    },
    install: () => {
      if (lifetime.current.pending) return;
      setState(previous => ({ ...previous, phase: 'downloading', bytes: 0, error: '' }));
      void act(api => api.InstallUpdate(locale));
    },
    cancel: () => { void act(api => api.CancelUpdate()); },
    dismiss: () => { if (!lifetime.current.pending && !updateBusy(state.phase)) setVisible(false); },
  };
}
