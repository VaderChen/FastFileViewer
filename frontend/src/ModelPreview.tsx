import { useEffect, useRef, useState } from 'react';
import type { ImageEntry, LocaleCode } from './types';
import { checkModelSignal, maxModelBytes, ModelError } from './modelResources';
import './modelPreview.css';

const labels = {
  'zh-TW': {
    title: '3D 預覽', loading: '正在載入 3D 模型…', parsing: '正在準備模型…', fit: '重設視角', retry: '重試',
    controls: '左鍵拖曳：旋轉 · 右鍵或 Shift＋左鍵：平移 · 滾輪：縮放',
    warning: '部分材質或貼圖無法載入，已顯示可用的模型內容。',
    resource: '無法讀取模型或其資源。請將材質與貼圖放在模型所在目錄或其子目錄。',
    large: '模型超過預覽大小上限，請先減少模型或貼圖的大小。',
    empty: '檔案內沒有可顯示的 3D 幾何資料。',
    unsupported: '此模型使用尚未支援的格式或壓縮方式，請改用未壓縮的 glTF／GLB。',
    webgl: '無法啟動 3D 繪圖，請重試或重新啟動程式。', invalid: '無法解析此模型，請確認檔案完整且格式正確。',
  },
  en: {
    title: '3D Preview', loading: 'Loading 3D model…', parsing: 'Preparing model…', fit: 'Reset view', retry: 'Retry',
    controls: 'Left drag: rotate · Right or Shift + left drag: pan · Wheel: zoom',
    warning: 'Some materials or textures could not be loaded. Available model content is displayed.',
    resource: 'Cannot read the model or its resources. Keep materials and textures in the model directory or its subdirectories.',
    large: 'This model exceeds the preview limit. Reduce the model or texture size first.',
    empty: 'This file contains no displayable 3D geometry.',
    unsupported: 'This model uses an unsupported format or compression. Try uncompressed glTF/GLB.',
    webgl: '3D rendering is unavailable. Retry or restart the app.', invalid: 'Cannot parse this model. Check that the file is complete and correctly formatted.',
  },
  ja: {
    title: '3D プレビュー', loading: '3D モデルを読み込み中…', parsing: 'モデルを準備中…', fit: '視点をリセット', retry: '再試行',
    controls: '左ドラッグ：回転 · 右または Shift＋左ドラッグ：移動 · ホイール：ズーム',
    warning: '一部のマテリアルやテクスチャを読み込めません。表示可能なモデルを表示しています。',
    resource: 'モデルまたは関連ファイルを読み込めません。マテリアルとテクスチャをモデルと同じフォルダーかその配下に置いてください。',
    large: 'プレビューの上限を超えています。モデルやテクスチャを小さくしてください。',
    empty: '表示可能な 3D ジオメトリがありません。',
    unsupported: '未対応の形式または圧縮を使用しています。非圧縮の glTF／GLB をお試しください。',
    webgl: '3D 描画を開始できません。再試行するか、アプリを再起動してください。', invalid: 'モデルを解析できません。ファイルと形式を確認してください。',
  },
};

export function ModelPreview({ entry, locale }: { entry: ImageEntry; locale: LocaleCode }) {
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<() => void>();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ phase: 'loading' | 'ready' | 'error'; progress: number; warning?: boolean; error?: ModelError['code'] }>({ phase: 'loading', progress: 0 });
  const t = labels[locale];
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let viewer: { dispose(): void } | undefined;
    setState({ phase: 'loading', progress: 0 });
    const timeout = window.setTimeout(() => {
      if (disposed) return;
      setState({ phase: 'error', progress: 0, error: 'resource' });
      controller.abort();
    }, 90_000);
    void (async () => {
      try {
        const { createModelViewer } = await import('./modelViewer');
        checkModelSignal(controller.signal);
        if (entry.size > maxModelBytes) throw new ModelError('large');
        const url = await window.go?.app?.MediaService?.PrepareModelByPath(entry.path).catch(() => { throw new ModelError('resource'); });
        checkModelSignal(controller.signal);
        if (!url || !host.current) throw new ModelError('resource');
        const current = createModelViewer(host.current, url, entry.format, controller.signal, {
          progress: progress => { if (!disposed) setState({ phase: 'loading', progress }); },
          contextLost: () => {
            if (!disposed) setState({ phase: 'error', progress: 0, error: 'webgl' });
            controller.abort();
          },
        });
        viewer = current;
        fit.current = current.fit;
        const result = await current.ready;
        if (!disposed && !controller.signal.aborted) setState({ phase: 'ready', progress: 1, warning: result.resourceWarning });
      } catch (error) {
        if (!disposed && !controller.signal.aborted) setState({ phase: 'error', progress: 0, error: error instanceof ModelError ? error.code : 'invalid' });
      } finally { window.clearTimeout(timeout); }
    })();
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
      viewer?.dispose();
      fit.current = undefined;
    };
  }, [entry.path, entry.format, attempt]);

  return (
    <article className="model-preview" aria-label={t.title} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
      <header className="model-toolbar">
        <strong>{t.title}</strong>
        <span title={entry.name}>{entry.name}</span>
        <button type="button" onClick={() => fit.current?.()} disabled={state.phase !== 'ready'}>{t.fit}</button>
      </header>
      <div className="model-viewport">
        <div className="model-canvas" ref={host} role="img" aria-label={`${t.title}: ${entry.name}`} />
        {state.phase === 'loading' ? <div className="model-status" role="status"><span>{state.progress >= 1 ? t.parsing : t.loading}</span><progress max={1} value={state.progress > 0 && state.progress < 1 ? state.progress : undefined} /></div> : null}
        {state.phase === 'error' ? <div className="model-status" role="alert"><span>{t[state.error ?? 'invalid']}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>{t.retry}</button></div> : null}
      </div>
      {state.warning ? <div className="model-warning" role="status">{t.warning}</div> : null}
      <footer className="model-controls">{t.controls}</footer>
    </article>
  );
}
