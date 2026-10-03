import { useEffect, useRef } from 'react';
import type { LocaleCode } from './types';
import type { AppUpdateState } from './appUpdates';
import { updateBusy, updateErrorMessage, updateMessages, updatePercent } from './appUpdates';
import { formatDownloadSize } from './downloads';
import './appUpdates.css';

interface Props {
  state: AppUpdateState;
  locale: LocaleCode;
  onInstall(): void;
  onCancel(): void;
  onClose(): void;
}

export function AppUpdateDialog({ state, locale, onInstall, onCancel, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const t = updateMessages[locale];
  const busy = updateBusy(state.phase);
  const installing = busy && state.phase !== 'checking';
  const percent = updatePercent(state);
  const error = state.error || state.installError;
  const canInstall = !busy && !!state.release && state.phase !== 'current' && !state.installError;
  const phaseLabel = state.phase === 'idle' ? t.checking : state.phase === 'error'
    ? updateErrorMessage(state.error, locale) : t[state.phase];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { previous?.focus?.(); };
  }, []);

  return (
    <div className="app-update-overlay" onClick={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        if (buttons.length === 0) { event.preventDefault(); return; }
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div ref={dialog} tabIndex={-1} className="app-update-dialog" role="dialog" aria-modal="true" aria-labelledby="app-update-title">
        <h2 id="app-update-title">{t.title}</h2>
        <p role="status" aria-live="polite">{phaseLabel}</p>
        <dl>
          <dt>{t.currentVersion}</dt><dd>{state.currentVersion || '—'}</dd>
          {state.release && state.phase !== 'current' ? <><dt>{t.newVersion}</dt><dd>{state.release.version}</dd></> : null}
        </dl>
        {state.phase === 'available' && state.release?.notes ? <pre className="app-update-notes">{state.release.notes}</pre> : null}
        {state.phase === 'available' ? <p>{t.explanation}</p> : null}
        {error && state.phase !== 'error' ? <p className="app-update-error" role="alert">{updateErrorMessage(error, locale)}</p> : null}
        {busy ? <>
          <progress value={percent} max={100} aria-label={phaseLabel} />
          {percent !== undefined ? <span className="app-update-progress">{percent}%{state.phase === 'downloading' && state.release
            ? ` · ${formatDownloadSize(state.bytes)} / ${formatDownloadSize(state.release.size)}` : ''}</span> : null}
        </> : null}
        <div className="app-update-actions">
          {!busy ? <button type="button" onClick={onClose}>{state.phase === 'available' ? t.later : t.close}</button> : null}
          {installing && state.phase !== 'restarting' ? <button type="button" onClick={onCancel}>{t.cancel}</button> : null}
          {canInstall ? <button className="app-update-primary" type="button" onClick={onInstall}>{t.install}</button> : null}
        </div>
      </div>
    </div>
  );
}
