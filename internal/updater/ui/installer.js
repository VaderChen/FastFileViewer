const labels = {
  'zh-TW': { waiting: '正在關閉 FastFileViewer…', installing: '正在安裝更新…', restarting: '正在重新啟動…', complete: '更新完成', error: '更新失敗，已嘗試還原並開啟原版本。', parent_running: '程式尚未關閉，更新已停止。請關閉程式後再試一次。', recovery: '無法自動還原。原版本保留在安裝目錄旁的 .FastFileViewer-update- 資料夾內。', close: '關閉' },
  en: { waiting: 'Closing FastFileViewer…', installing: 'Installing update…', restarting: 'Restarting…', complete: 'Update complete', error: 'Update failed. Recovery and reopening of the previous version were attempted.', parent_running: 'The app is still running. Close it and try updating again.', recovery: 'Automatic recovery failed. The previous app is preserved in the .FastFileViewer-update- folder beside the installation.', close: 'Close' },
  ja: { waiting: 'FastFileViewer を終了中…', installing: '更新をインストール中…', restarting: '再起動中…', complete: '更新完了', error: '更新に失敗しました。以前のバージョンの復元と起動を試みました。', parent_running: 'アプリがまだ動作中です。終了してから再試行してください。', recovery: '自動復元に失敗しました。以前のアプリはインストール先の隣の .FastFileViewer-update- フォルダに保存されています。', close: '閉じる' },
};
const api = window.go.updater.Installer;
let ended = false;
document.getElementById('close').addEventListener('click', () => { void api.Close(); });
async function refresh() {
  try {
    const state = await api.GetProgress();
    const text = labels[state.locale] ?? labels.en;
    document.documentElement.lang = state.locale || 'en';
    document.getElementById('version').textContent = state.version;
    document.getElementById('status').textContent = state.phase === 'error' ? (text[state.error] ?? text.error) : text[state.phase];
    document.getElementById('progress').value = state.percent;
    document.getElementById('percent').textContent = `${state.percent}%`;
    document.getElementById('close').textContent = text.close;
    document.getElementById('close').hidden = state.phase !== 'error';
    ended = state.phase === 'complete' || state.phase === 'error';
  } finally {
    if (!ended) window.setTimeout(() => { void refresh().catch(() => {}); }, 250);
  }
}
await refresh();
// Two frames ensure the independent progress window is painted before handoff.
requestAnimationFrame(() => requestAnimationFrame(() => { void api.Begin(); }));
