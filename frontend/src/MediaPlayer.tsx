import { useEffect, useRef, useState } from 'react';
import type { ImageEntry } from './types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClosedCaptioning, faSliders } from '@fortawesome/free-solid-svg-icons';
import {
  audioSpectrumMaximumDecibels,
  audioSpectrumMinimumDecibels,
  calculateLogSpectrumAmplitudes,
  convertSubtitleToWebVTT,
  sidecarSubtitlePaths,
} from './mediaSupport';

interface MediaPlayerLabels {
  loading: string;
  playbackFailed: string;
  conversionConfirmTitle: string;
  conversionConfirmMessage: string;
  conversionConfirm: string;
  conversionCancel: string;
  conversionCancelled: string;
  conversionProgressTitle: string;
  conversionProgressMessage: string;
  remuxCleanupTitle: string;
  remuxCleanupMessage: string;
  remuxCleanupConfirm: string;
  remuxCleanupCancel: string;
  subtitleFailed: string;
  play: string;
  pause: string;
  backward: string;
  forward: string;
  mute: string;
  unmute: string;
  subtitlesOn: string;
  subtitlesOff: string;
  fullscreen: string;
  subtitleSettings: string;
  subtitleFont: string;
  subtitleFontSize: string;
  subtitleTextColor: string;
  subtitleBackground: string;
  subtitleOpacity: string;
  subtitlePosition: string;
  seek: string;
  visualizer: string;
  colors: string;
  spectrum: string;
  waveform: string;
  bothVisualizations: string;
}

interface MediaPlayerProps {
  entry: ImageEntry;
  subtitle: ImageEntry | null;
  labels: MediaPlayerLabels;
  visible?: boolean;
  pausePlayback?: boolean;
  fullscreen?: boolean;
  onAudioEnded?: () => boolean;
  onOriginalReplaced?: (replacement: ImageEntry, replacedEntryId: string) => void;
}

interface ResumedVideoPlayback {
  entryId: string;
  position: number;
  playing: boolean;
}

interface AudioGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  muteGain: GainNode;
  disposeTimer: number | null;
}

type AudioVisualizationMode = 'spectrum' | 'waveform' | 'both';
type ConversionDialogState = { phase: 'confirm' | 'progress'; name: string };
interface SubtitlePresentation {
  bottomOffset: number;
  textColor: string;
  background: string;
  opacity: number;
  font: string;
  fontScale: number;
}
interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

const audioGraphs = new WeakMap<HTMLAudioElement, AudioGraph>();
const audioVisualizationStorageKey = 'fastfileviewer.audioVisualizationMode';

export function MediaPlayer({ entry, subtitle, labels, visible = true, pausePlayback = false, fullscreen = false, onAudioEnded, onOriginalReplaced }: MediaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnimationRef = useRef<number | null>(null);
  const audioFallbackAttemptedRef = useRef(false);
  const remuxCleanupPromptRef = useRef<Promise<unknown> | null>(null);
  const remuxCleanupDecisionRef = useRef<((approved: boolean) => void) | null>(null);
  const conversionDecisionRef = useRef<((approved: boolean) => void) | null>(null);
  const prepareOperationRef = useRef(0);
  const resumedPlaybackRef = useRef<ResumedVideoPlayback | null>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const resumeAudioAfterSourceChangeRef = useRef(false);
  const videoFrameRef = useRef<HTMLDivElement>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const [mediaURL, setMediaURL] = useState('');
  const [subtitleURL, setSubtitleURL] = useState('');
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [error, setError] = useState('');
  const [subtitleError, setSubtitleError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleSettingsOpen, setSubtitleSettingsOpen] = useState(false);
  const [subtitleFont, setSubtitleFont] = useState(() => localStorage.getItem('fastfileviewer.subtitleFont') || 'system-ui');
  const [subtitleFontScale, setSubtitleFontScale] = useState(() => readSubtitleNumber('fastfileviewer.subtitleFontScale', 50, 50, 300));
  const [subtitleTextColor, setSubtitleTextColor] = useState(() => localStorage.getItem('fastfileviewer.subtitleTextColor') || '#ffffff');
  const [subtitleBackground, setSubtitleBackground] = useState(() => localStorage.getItem('fastfileviewer.subtitleBackground') || '#000000');
  const [subtitleOpacity, setSubtitleOpacity] = useState(() => readSubtitleNumber('fastfileviewer.subtitleOpacity', 0.2, 0, 1));
  const [subtitlePosition, setSubtitlePosition] = useState(() => readStoredNumber('fastfileviewer.subtitlePosition', 5, 0, 40));
  const [audioVisualizationMode, setAudioVisualizationMode] = useState<AudioVisualizationMode>(resolveInitialAudioVisualizationMode);
  const [colorsEnabled, setColorsEnabled] = useState(() => localStorage.getItem('fastfileviewer.audioVisualizerColors') === 'true');
  const [conversionDialog, setConversionDialog] = useState<ConversionDialogState | null>(null);
  const [remuxCleanupDialogName, setRemuxCleanupDialogName] = useState('');

  const askConversionApproval = (name: string): Promise<boolean> => new Promise((resolve) => {
    conversionDecisionRef.current?.(false);
    conversionDecisionRef.current = resolve;
    setConversionDialog({ phase: 'confirm', name });
  });

  const resolveConversionApproval = (approved: boolean) => {
    const resolve = conversionDecisionRef.current;
    conversionDecisionRef.current = null;
    setConversionDialog(null);
    resolve?.(approved);
  };

  const askRemuxCleanupApproval = (name: string): Promise<boolean> => new Promise((resolve) => {
    remuxCleanupDecisionRef.current?.(false);
    remuxCleanupDecisionRef.current = resolve;
    setRemuxCleanupDialogName(name);
  });

  const resolveRemuxCleanupApproval = (approved: boolean) => {
    const resolve = remuxCleanupDecisionRef.current;
    remuxCleanupDecisionRef.current = null;
    setRemuxCleanupDialogName('');
    resolve?.(approved);
  };

  const clearControlsHideTimer = () => {
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
  };

  const [controlsVisible, setControlsVisible] = useState(true);

  useEffect(() => {
    clearControlsHideTimer();
    // 一般視窗固定顯示；進入全螢幕後等待滑鼠活動才顯示控制列。
    setControlsVisible(!fullscreen);
    return clearControlsHideTimer;
  }, [entry.id, fullscreen]);

  const revealControls = () => {
    if (!fullscreen) {
      return;
    }
    setControlsVisible(true);
    clearControlsHideTimer();
    controlsHideTimerRef.current = window.setTimeout(() => {
      controlsHideTimerRef.current = null;
      setControlsVisible(false);
    }, 5000);
  };

  useEffect(() => {
    localStorage.setItem(audioVisualizationStorageKey, audioVisualizationMode);
  }, [audioVisualizationMode]);

  useEffect(() => {
    localStorage.setItem('fastfileviewer.subtitleFont', subtitleFont);
    localStorage.setItem('fastfileviewer.subtitleFontScale', String(subtitleFontScale));
    localStorage.setItem('fastfileviewer.subtitleTextColor', subtitleTextColor);
    localStorage.setItem('fastfileviewer.subtitleBackground', subtitleBackground);
    localStorage.setItem('fastfileviewer.subtitleOpacity', String(subtitleOpacity));
    localStorage.setItem('fastfileviewer.subtitlePosition', String(subtitlePosition));
  }, [subtitleBackground, subtitleFont, subtitleFontScale, subtitleOpacity, subtitlePosition, subtitleTextColor]);

  useEffect(() => {
    localStorage.setItem('fastfileviewer.audioVisualizerColors', String(colorsEnabled));
  }, [colorsEnabled]);

  useEffect(() => {
    let cancelled = false;
    resumeAudioAfterSourceChangeRef.current = resumeAudioAfterSourceChangeRef.current
      || (entry.kind === 'audio' && audioRef.current !== null && !audioRef.current.paused);
    setMediaURL('');
    setError('');
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    audioFallbackAttemptedRef.current = entry.kind === 'audio' && requiresEagerAudioCompatibility(entry.format);
    remuxCleanupPromptRef.current = null;
    // 解壓與改封裝可能很久，掛上操作編號讓切換檔案時能真正中止後端工作。
    void (async () => {
      const operationId = await window.go?.app?.App?.BeginOperation?.() ?? 0;
      prepareOperationRef.current = operationId;
      try {
        if (cancelled) {
          return;
        }
        const needsConversion = requiresMediaConversion(entry);
        if (needsConversion) {
          const approved = await askConversionApproval(entry.name);
          if (!approved || cancelled) {
            if (!cancelled) {
              setError(labelsRef.current.conversionCancelled);
            }
            return;
          }
          setConversionDialog({ phase: 'progress', name: entry.name });
        }
        const url = await window.go?.app?.MediaService?.PrepareMediaByPath?.(entry.path, operationId);
        if (cancelled || !url) {
          return;
        }
        setMediaURL(url);
        if (entry.kind === 'video' && requiresVideoRemux(entry.format)) {
          remuxCleanupPromptRef.current = askRemuxCleanupApproval(entry.name)
            .then(async (approved) => {
              if (!approved) {
                return null;
              }
              return window.go?.app?.MediaService?.ReplaceRemuxedOriginal?.(entry.path) ?? null;
            })
            .then((replacement) => {
              if (!replacement?.id) {
                return;
              }
              // 原始影片已經進垃圾桶，即使使用者已經切到別的檔案也必須更新清單。
              if (!cancelled) {
                const video = videoRef.current;
                resumedPlaybackRef.current = {
                  entryId: replacement.id,
                  position: video?.currentTime ?? 0,
                  playing: video ? !video.paused : false,
                };
              }
              onOriginalReplaced?.(replacement, entry.id);
            })
            .catch(() => null);
        }
      } catch (reason: unknown) {
        if (!cancelled) {
          resumeAudioAfterSourceChangeRef.current = false;
          setError(reason instanceof Error && reason.message
            ? reason.message
            : typeof reason === 'string' && reason
              ? reason
              : labelsRef.current.playbackFailed);
        }
      } finally {
        if (prepareOperationRef.current === operationId) {
          setConversionDialog(null);
        }
        finishPrepareOperation(prepareOperationRef, operationId);
      }
    })();
    return () => {
      cancelled = true;
      conversionDecisionRef.current?.(false);
      conversionDecisionRef.current = null;
      setConversionDialog(null);
      remuxCleanupDecisionRef.current?.(false);
      remuxCleanupDecisionRef.current = null;
      setRemuxCleanupDialogName('');
      if (prepareOperationRef.current !== 0) {
        void window.go?.app?.App?.CancelOperation?.(prepareOperationRef.current);
      }
      // 詢問是否保留改封裝結果的對話框還開著時，要等它結束才能釋放暫存檔。
      const pendingPrompt = remuxCleanupPromptRef.current;
      remuxCleanupPromptRef.current = null;
      const releasePlaybackCache = () => {
        void window.go?.app?.MediaService?.ReleasePlaybackCache?.(entry.path).catch(() => undefined);
      };
      if (pendingPrompt) {
        void pendingPrompt.then(releasePlaybackCache, releasePlaybackCache);
      } else {
        releasePlaybackCache();
      }
    };
  }, [entry.id, entry.path]);

  useEffect(() => {
    if (entry.kind !== 'audio' || !mediaURL) {
      return;
    }
    const audio = audioRef.current;
    const canvas = audioCanvasRef.current;
    const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!audio || !canvas || !AudioContextConstructor) {
      return;
    }

    let graph: AudioGraph;
    try {
      graph = acquireAudioGraph(audio, AudioContextConstructor);
    } catch {
      return;
    }
    const { context, analyser } = graph;
    audioContextRef.current = context;

    const frequencyData = new Float32Array(analyser.frequencyBinCount);
    const waveformData = new Uint8Array(analyser.fftSize);
    const draw = () => {
      if (visible) {
        drawAudioVisualization(canvas, analyser, frequencyData, waveformData, audio.paused, audioVisualizationMode, colorsEnabled);
      }
      if (visible && !audio.paused && !audio.ended) {
        audioAnimationRef.current = window.requestAnimationFrame(draw);
      } else {
        audioAnimationRef.current = null;
      }
    };
    const startDrawing = () => {
      void context.resume().catch(() => undefined);
      if (visible && audioAnimationRef.current === null) {
        audioAnimationRef.current = window.requestAnimationFrame(draw);
      }
    };
    const stopDrawing = () => {
      if (audioAnimationRef.current !== null) {
        window.cancelAnimationFrame(audioAnimationRef.current);
        audioAnimationRef.current = null;
      }
      if (visible) {
        drawAudioVisualization(canvas, analyser, frequencyData, waveformData, true, audioVisualizationMode, colorsEnabled);
      }
    };
    const applyMuteImmediately = () => {
      graph.muteGain.gain.cancelScheduledValues(context.currentTime);
      graph.muteGain.gain.setValueAtTime(audio.muted ? 0 : 1, context.currentTime);
    };

    audio.addEventListener('play', startDrawing);
    audio.addEventListener('pause', stopDrawing);
    audio.addEventListener('ended', stopDrawing);
    audio.addEventListener('volumechange', applyMuteImmediately);
    applyMuteImmediately();
    if (audio.paused || audio.ended) {
      if (visible) {
        drawAudioVisualization(canvas, analyser, frequencyData, waveformData, true, audioVisualizationMode, colorsEnabled);
      }
    } else {
      startDrawing();
    }
    return () => {
      audio.removeEventListener('play', startDrawing);
      audio.removeEventListener('pause', stopDrawing);
      audio.removeEventListener('ended', stopDrawing);
      audio.removeEventListener('volumechange', applyMuteImmediately);
      if (audioAnimationRef.current !== null) {
        window.cancelAnimationFrame(audioAnimationRef.current);
        audioAnimationRef.current = null;
      }
      audioContextRef.current = null;
      releaseAudioGraph(audio, graph);
    };
  }, [audioVisualizationMode, colorsEnabled, entry.kind, mediaURL, visible]);

  useEffect(() => {
    const audio = audioRef.current;
    if (pausePlayback && audio && !audio.paused) {
      audio.pause();
    }
  }, [pausePlayback]);

  const handleAudioError = async () => {
    if (audioFallbackAttemptedRef.current || !window.go?.app?.MediaService?.PrepareCompatibleMediaByPath) {
      setError(labels.playbackFailed);
      return;
    }
    audioFallbackAttemptedRef.current = true;
    setError('');
    const operationId = await window.go?.app?.App?.BeginOperation?.() ?? 0;
    prepareOperationRef.current = operationId;
    const approved = await askConversionApproval(entry.name);
    if (!approved) {
      setError(labels.conversionCancelled);
      finishPrepareOperation(prepareOperationRef, operationId);
      return;
    }
    setConversionDialog({ phase: 'progress', name: entry.name });
    try {
      const compatibleURL = await window.go.app.MediaService.PrepareCompatibleMediaByPath(entry.path, operationId);
      if (!compatibleURL) {
        setError(labels.playbackFailed);
        return;
      }
      setMediaURL(compatibleURL);
    } catch (reason) {
      setError(reason instanceof Error && reason.message
        ? reason.message
        : typeof reason === 'string' && reason
          ? reason
          : labels.playbackFailed);
    } finally {
      if (prepareOperationRef.current === operationId) {
        setConversionDialog(null);
      }
      finishPrepareOperation(prepareOperationRef, operationId);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let objectURL = '';
    setSubtitleURL('');
    setSubtitleCues([]);
    setSubtitleError('');
    if (entry.kind !== 'video') {
      return () => undefined;
    }
    const subtitlePaths = subtitle ? [subtitle.path] : sidecarSubtitlePaths(entry);
    if (subtitlePaths.length === 0) {
      return () => undefined;
    }
    void (async () => {
      for (const subtitlePath of subtitlePaths) {
        if (cancelled) return;
        try {
          const payload = await window.go?.app?.App?.LoadDocumentByPath?.(subtitlePath);
          if (!payload) continue;
          const webVTT = convertSubtitleToWebVTT(payload.text, payload.format);
          if (!webVTT) continue;
          const styledWebVTT = applySubtitlePresentation(webVTT, {
            bottomOffset: subtitlePosition,
            textColor: subtitleTextColor,
            background: subtitleBackground,
            opacity: subtitleOpacity,
            font: subtitleFont,
            fontScale: subtitleFontScale,
          });
          objectURL = URL.createObjectURL(new Blob([styledWebVTT], { type: 'text/vtt;charset=utf-8' }));
          setSubtitleCues(parseWebVTTCues(webVTT));
          setSubtitleURL(objectURL);
          return;
        } catch {
          // 自動推導的字幕不存在時繼續嘗試下一個格式。
        }
      }
      // 自動推導的同名字幕不存在是正常情況；只有已掃描到的字幕載入失敗才顯示錯誤。
      if (!cancelled && subtitle) setSubtitleError(labels.subtitleFailed);
    })();
    return () => {
      cancelled = true;
      if (objectURL) {
        URL.revokeObjectURL(objectURL);
      }
    };
  }, [entry.kind, entry.path, labels.subtitleFailed, subtitle, subtitleBackground, subtitleFont, subtitleFontScale, subtitleOpacity, subtitlePosition, subtitleTextColor]);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      try {
        await video.play();
      } catch {
        setError(labels.playbackFailed);
      }
    } else {
      video.pause();
    }
  };

  const seekBy = (seconds: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.currentTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : 0, video.currentTime + seconds));
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.muted = !video.muted;
  };

  const conversionDialogView = conversionDialog ? (
    <div className="media-conversion-overlay" role="presentation">
      <section
        className="media-conversion-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={conversionDialog.phase === 'confirm' ? labels.conversionConfirmTitle : labels.conversionProgressTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {conversionDialog.phase === 'progress' ? <span className="media-conversion-spinner" aria-hidden="true" /> : <span className="media-conversion-icon" aria-hidden="true">↻</span>}
        <strong>{conversionDialog.phase === 'confirm' ? labels.conversionConfirmTitle : labels.conversionProgressTitle}</strong>
        <p>{(conversionDialog.phase === 'confirm' ? labels.conversionConfirmMessage : labels.conversionProgressMessage).replace('{name}', conversionDialog.name)}</p>
        {conversionDialog.phase === 'confirm' ? (
          <footer>
            <button type="button" className="media-conversion-cancel" onClick={() => resolveConversionApproval(false)}>{labels.conversionCancel}</button>
            <button type="button" className="media-conversion-confirm" onClick={() => resolveConversionApproval(true)}>{labels.conversionConfirm}</button>
          </footer>
        ) : null}
      </section>
    </div>
  ) : null;

  const remuxCleanupDialogView = remuxCleanupDialogName ? (
    <div className="media-conversion-overlay" role="presentation">
      <section
        className="media-conversion-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={labels.remuxCleanupTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="media-conversion-icon media-conversion-complete" aria-hidden="true">✓</span>
        <strong>{labels.remuxCleanupTitle}</strong>
        <p>{labels.remuxCleanupMessage.replace('{name}', remuxCleanupDialogName)}</p>
        <footer>
          <button type="button" className="media-conversion-cancel" onClick={() => resolveRemuxCleanupApproval(false)}>{labels.remuxCleanupCancel}</button>
          <button type="button" className="media-conversion-confirm" onClick={() => resolveRemuxCleanupApproval(true)}>{labels.remuxCleanupConfirm}</button>
        </footer>
      </section>
    </div>
  ) : null;

  if (!mediaURL && !error) {
    return <div className="media-player-status">{labels.loading}{conversionDialogView}{remuxCleanupDialogView}</div>;
  }

  const visibleSubtitleCues = subtitlesEnabled
    ? subtitleCues.filter((cue) => currentTime >= cue.start && currentTime < cue.end)
    : [];

  return (
    <div className={`media-player ${entry.kind}`}>
      {conversionDialogView}
      {remuxCleanupDialogView}
      {entry.kind === 'video' && mediaURL ? (
        <div
          ref={videoFrameRef}
          className={`video-player-frame ${fullscreen && !controlsVisible ? 'controls-hidden' : ''}`}
          onPointerMove={revealControls}
        >
          <style>{`.video-player-frame video::cue { color: ${subtitleTextColor} !important; background: ${hexToRgba(subtitleBackground, subtitleOpacity)} !important; background-color: ${hexToRgba(subtitleBackground, subtitleOpacity)} !important; font-family: ${subtitleFont} !important; font-size: ${subtitleFontScale}% !important; }`}</style>
          <video
            ref={videoRef}
            key={mediaURL}
            playsInline
            preload="metadata"
            tabIndex={0}
            onClick={() => void togglePlayback()}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                void togglePlayback();
              } else if (event.key === 'ArrowLeft') {
                seekBy(-10);
              } else if (event.key === 'ArrowRight') {
                seekBy(10);
              }
            }}
            onLoadedMetadata={(event) => {
              setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
              resumeReplacedPlayback(event.currentTarget, entry.id, resumedPlaybackRef);
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onVolumeChange={(event) => {
              setVolume(event.currentTarget.volume);
              setMuted(event.currentTarget.muted);
            }}
            onError={() => setError(labels.playbackFailed)}
          >
            <source src={mediaURL} />
          </video>
          {visibleSubtitleCues.length > 0 ? (
            <div className="subtitle-overlay" aria-live="off">
              <div className="subtitle-overlay-content" style={{
                bottom: `${subtitlePosition}%`,
                color: subtitleTextColor,
                backgroundColor: hexToRgba(subtitleBackground, subtitleOpacity),
                fontFamily: subtitleFont,
                fontSize: `clamp(12px, ${subtitleFontScale * 0.05}vh, 120px)`,
              }}>
                {visibleSubtitleCues.map((cue, index) => <div key={`${cue.start}-${cue.end}-${index}`}>{cue.text}</div>)}
              </div>
            </div>
          ) : null}
          <div className="custom-video-controls" onDoubleClick={(event) => event.stopPropagation()}>
            <button type="button" title={playing ? labels.pause : labels.play} aria-label={playing ? labels.pause : labels.play} onClick={() => void togglePlayback()}>
              <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
            </button>
            <button type="button" title={labels.backward} aria-label={labels.backward} onClick={() => seekBy(-10)}>−10</button>
            <button type="button" title={labels.forward} aria-label={labels.forward} onClick={() => seekBy(10)}>+10</button>
            <span className="video-time">{formatMediaTime(currentTime)}</span>
            <input
              className="video-timeline"
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={Math.min(currentTime, duration || 0)}
              aria-label={labels.seek}
              onChange={(event) => {
                const nextTime = Number(event.target.value);
                if (videoRef.current) {
                  videoRef.current.currentTime = nextTime;
                }
                setCurrentTime(nextTime);
              }}
            />
            <span className="video-time">{formatMediaTime(duration)}</span>
            <button type="button" title={muted ? labels.unmute : labels.mute} aria-label={muted ? labels.unmute : labels.mute} onClick={toggleMute}>
              <span aria-hidden="true">{muted || volume === 0 ? '🔇' : '🔊'}</span>
            </button>
            <input
              className="video-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              aria-label={muted ? labels.unmute : labels.mute}
              onChange={(event) => {
                const nextVolume = Number(event.target.value);
                if (videoRef.current) {
                  videoRef.current.volume = nextVolume;
                  videoRef.current.muted = nextVolume === 0;
                }
              }}
            />
            {subtitleURL ? (
              <button
                className={`cc-toggle ${subtitlesEnabled ? 'active' : ''}`}
                type="button"
                title={subtitlesEnabled ? labels.subtitlesOff : labels.subtitlesOn}
                aria-label={subtitlesEnabled ? labels.subtitlesOff : labels.subtitlesOn}
                onClick={() => setSubtitlesEnabled((current) => !current)}
              >
                CC
              </button>
            ) : null}
            {subtitleURL ? (
              <button
                className={subtitleSettingsOpen ? 'active' : ''}
                type="button"
                title={labels.subtitleSettings}
                aria-label={labels.subtitleSettings}
                aria-expanded={subtitleSettingsOpen}
                onClick={() => setSubtitleSettingsOpen((current) => !current)}
              >
                <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
              </button>
            ) : null}
            {subtitleSettingsOpen && subtitleURL ? (
              <div className="subtitle-settings-popover" role="dialog" aria-label={labels.subtitleSettings} onMouseDown={(event) => event.stopPropagation()}>
                <strong><FontAwesomeIcon icon={faClosedCaptioning} /> {labels.subtitleSettings}</strong>
                <label>
                  <span>{labels.subtitleFont}</span>
                  <select value={subtitleFont} onChange={(event) => setSubtitleFont(event.target.value)}>
                    <option value="system-ui">System</option>
                    <option value="sans-serif">Sans Serif</option>
                    <option value="serif">Serif</option>
                    <option value="monospace">Monospace</option>
                  </select>
                </label>
                <label>
                  <span>{labels.subtitleFontSize} <output>{subtitleFontScale}%</output></span>
                  <input type="range" min="50" max="300" step="5" value={subtitleFontScale} onChange={(event) => setSubtitleFontScale(Number(event.target.value))} />
                </label>
                <label className="subtitle-color-field">
                  <span>{labels.subtitleTextColor}</span>
                  <input type="color" value={subtitleTextColor} onChange={(event) => setSubtitleTextColor(event.target.value)} />
                </label>
                <label className="subtitle-color-field">
                  <span>{labels.subtitleBackground}</span>
                  <input type="color" value={subtitleBackground} onChange={(event) => setSubtitleBackground(event.target.value)} />
                </label>
                <label>
                  <span>{labels.subtitleOpacity} <output>{Math.round(subtitleOpacity * 100)}%</output></span>
                  <input type="range" min="0" max="1" step="0.05" value={subtitleOpacity} onChange={(event) => setSubtitleOpacity(Number(event.target.value))} />
                </label>
                <label>
                  <span>{labels.subtitlePosition} <output>{subtitlePosition}%</output></span>
                  <input type="range" min="0" max="40" step="1" value={subtitlePosition} onChange={(event) => setSubtitlePosition(Number(event.target.value))} />
                </label>
              </div>
            ) : null}
          </div>
        </div>
      ) : entry.kind === 'audio' && mediaURL ? (
        <div className="audio-player-card">
          <div className="audio-player-title">
            <strong>{entry.name}</strong>
            <span>{entry.format.replace('.', '').toUpperCase()}</span>
          </div>
          <div className="audio-visualizer-toolbar">
            <span>{labels.visualizer}</span>
            <div className="audio-visualizer-actions">
              <button
                className={`audio-colors-button ${colorsEnabled ? 'active' : ''}`}
                type="button"
                aria-pressed={colorsEnabled}
                onClick={() => setColorsEnabled((current) => !current)}
              >
                <span className="audio-status-dot" aria-hidden="true" />
                {labels.colors}
              </button>
              <div role="group" aria-label={labels.visualizer}>
                <button
                  className={audioVisualizationMode === 'spectrum' ? 'active' : ''}
                  type="button"
                  aria-pressed={audioVisualizationMode === 'spectrum'}
                  onClick={() => setAudioVisualizationMode('spectrum')}
                >
                  {labels.spectrum}
                </button>
                <button
                  className={audioVisualizationMode === 'waveform' ? 'active' : ''}
                  type="button"
                  aria-pressed={audioVisualizationMode === 'waveform'}
                  onClick={() => setAudioVisualizationMode('waveform')}
                >
                  {labels.waveform}
                </button>
                <button
                  className={audioVisualizationMode === 'both' ? 'active' : ''}
                  type="button"
                  aria-pressed={audioVisualizationMode === 'both'}
                  onClick={() => setAudioVisualizationMode('both')}
                >
                  {labels.bothVisualizations}
                </button>
              </div>
            </div>
          </div>
          <canvas
            ref={audioCanvasRef}
            className={`audio-visualizer mode-${audioVisualizationMode}`}
            role="img"
            aria-label={`${labels.visualizer}: ${audioVisualizationMode === 'spectrum' ? labels.spectrum : audioVisualizationMode === 'waveform' ? labels.waveform : labels.bothVisualizations}`}
          />
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={mediaURL}
            autoPlay={resumeAudioAfterSourceChangeRef.current}
            onCanPlay={(event) => {
              if (!resumeAudioAfterSourceChangeRef.current) {
                return;
              }
              resumeAudioAfterSourceChangeRef.current = false;
              void event.currentTarget.play().catch(() => undefined);
            }}
            onPlay={() => {
              setPlaying(true);
              void audioContextRef.current?.resume().catch(() => undefined);
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              resumeAudioAfterSourceChangeRef.current = onAudioEnded?.() ?? false;
            }}
            onError={() => void handleAudioError()}
          />
        </div>
      ) : null}
      {error ? <div className="media-playback-error">{error}</div> : null}
      {subtitleError ? <div className="media-subtitle-error">{subtitleError}</div> : null}
    </div>
  );
}

function acquireAudioGraph(audio: HTMLAudioElement, AudioContextConstructor: typeof AudioContext): AudioGraph {
  const existing = audioGraphs.get(audio);
  if (existing) {
    if (existing.disposeTimer !== null) {
      window.clearTimeout(existing.disposeTimer);
      existing.disposeTimer = null;
    }
    return existing;
  }
  const context = new AudioContextConstructor({ latencyHint: 'interactive' });
  const source = context.createMediaElementSource(audio);
  const analyser = context.createAnalyser();
  const muteGain = context.createGain();
  analyser.fftSize = 32768;
  analyser.minDecibels = audioSpectrumMinimumDecibels;
  analyser.maxDecibels = audioSpectrumMaximumDecibels;
  analyser.smoothingTimeConstant = 0.78;
  source.connect(analyser);
  analyser.connect(muteGain);
  muteGain.connect(context.destination);
  const graph = { context, source, analyser, muteGain, disposeTimer: null };
  audioGraphs.set(audio, graph);
  return graph;
}

function releaseAudioGraph(audio: HTMLAudioElement, graph: AudioGraph) {
  if (graph.disposeTimer !== null) {
    window.clearTimeout(graph.disposeTimer);
  }
  graph.disposeTimer = window.setTimeout(() => {
    if (audioGraphs.get(audio) !== graph) {
      return;
    }
    graph.source.disconnect();
    graph.analyser.disconnect();
    graph.muteGain.disconnect();
    audioGraphs.delete(audio);
    void graph.context.close().catch(() => undefined);
  }, 100);
}

// finishPrepareOperation 會結束後端的操作紀錄，並清掉仍指向這次準備工作的參考。
function finishPrepareOperation(operationRef: { current: number }, operationId: number) {
  if (operationId !== 0) {
    void window.go?.app?.App?.FinishOperation?.(operationId);
  }
  if (operationRef.current === operationId) {
    operationRef.current = 0;
  }
}

// requiresVideoRemux 對應 Go 端的同名判斷：WebKit 無法直接播放、需要改封裝的容器。
function requiresVideoRemux(format: string): boolean {
  return ['.mkv', '.avi', '.m2ts'].includes(format.toLowerCase());
}

function requiresMediaConversion(entry: ImageEntry): boolean {
  return (entry.kind === 'video' && requiresVideoRemux(entry.format))
    || (entry.kind === 'audio' && requiresEagerAudioCompatibility(entry.format));
}

// resumeReplacedPlayback 會在原始影片換成保存後的檔案時，接回原本的播放位置。
function resumeReplacedPlayback(
  video: HTMLVideoElement,
  entryId: string,
  resumedPlaybackRef: { current: ResumedVideoPlayback | null },
) {
  const resumed = resumedPlaybackRef.current;
  if (!resumed || resumed.entryId !== entryId) {
    return;
  }
  resumedPlaybackRef.current = null;
  if (resumed.position > 0) {
    video.currentTime = resumed.position;
  }
  if (resumed.playing) {
    void video.play().catch(() => undefined);
  }
}

function requiresEagerAudioCompatibility(format: string): boolean {
  return ['.wma', '.ape', '.wv', '.alac', '.ac3', '.amr', '.mka'].includes(format.toLowerCase());
}

function hexToRgba(hex: string, opacity: number): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '000000';
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, opacity))})`;
}

// 將字幕底部間距轉成 WebVTT cue 的 line 百分比；保留字幕原有的定位設定。
function applySubtitlePosition(webVTT: string, bottomOffset: number): string {
  const linePosition = Math.min(95, Math.max(55, 95 - bottomOffset));
  return webVTT.split('\n').map((line) => {
    if (!line.includes('-->')) {
      return line;
    }
    const timingAndSettings = line.split(/\s+/).slice(2);
    if (timingAndSettings.some((setting) => /^(line|position|align):/i.test(setting))) {
      return line;
    }
    return `${line} line:${linePosition}% position:50% align:center`;
  }).join('\n');
}

// 將樣式寫入 VTT STYLE 區塊，確保 WebKit 不會套用內建的半透明字幕底色。
function applySubtitlePresentation(webVTT: string, presentation: SubtitlePresentation): string {
  const positioned = applySubtitlePosition(webVTT, presentation.bottomOffset);
  const cueBackground = hexToRgba(presentation.background, presentation.opacity);
  const supportedFonts = new Set(['system-ui', 'sans-serif', 'serif', 'monospace']);
  const font = supportedFonts.has(presentation.font) ? presentation.font : 'system-ui';
  const cueStyle = [
    'STYLE',
    '::cue {',
    `  color: ${presentation.textColor};`,
    `  background: ${cueBackground};`,
    `  background-color: ${cueBackground};`,
    `  font-family: ${font};`,
    `  font-size: ${presentation.fontScale}%;`,
    '}',
  ].join('\n');
  const content = positioned.replace(/^WEBVTT(?:\n+|$)/i, '');
  return `WEBVTT\n\n${cueStyle}\n\n${content}`;
}

function parseWebVTTCues(webVTT: string): SubtitleCue[] {
  return webVTT.split(/\n{2,}/).flatMap((block): SubtitleCue[] => {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) {
      return [];
    }
    const timing = lines[timingIndex].match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (!timing) {
      return [];
    }
    const text = lines.slice(timingIndex + 1).join('\n').trim();
    if (!text) {
      return [];
    }
    return [{
      start: parseWebVTTTime(timing[1]),
      end: parseWebVTTTime(timing[2]),
      text: decodeSubtitleText(text),
    }];
  });
}

function parseWebVTTTime(value: string): number {
  const parts = value.split(':');
  const seconds = Number(parts.pop() ?? 0);
  const minutes = Number(parts.pop() ?? 0);
  const hours = Number(parts.pop() ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function decodeSubtitleText(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]*>/g, '');
}

function readStoredNumber(key: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

function readSubtitleNumber(key: string, fallback: number, minimum: number, maximum: number): number {
  // 將尚未調整過的舊版預設（100%、72%）一次更新為新的預設值，已自訂的設定則保留。
  const oldScale = Number(localStorage.getItem('fastfileviewer.subtitleFontScale'));
  const oldOpacity = Number(localStorage.getItem('fastfileviewer.subtitleOpacity'));
  if (oldScale === 100 && oldOpacity === 0.72) {
    return fallback;
  }
  return readStoredNumber(key, fallback, minimum, maximum);
}

function resolveInitialAudioVisualizationMode(): AudioVisualizationMode {
  const storedMode = localStorage.getItem(audioVisualizationStorageKey);
  return storedMode === 'spectrum' || storedMode === 'waveform' || storedMode === 'both' ? storedMode : 'both';
}

function drawAudioVisualization(
  canvas: HTMLCanvasElement,
  analyser: AnalyserNode,
  frequencyData: Float32Array<ArrayBuffer>,
  waveformData: Uint8Array<ArrayBuffer>,
  idle: boolean,
  mode: AudioVisualizationMode,
  colorsEnabled: boolean,
) {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  const displayWidth = Math.max(320, canvas.clientWidth);
  const displayHeight = Math.max(180, canvas.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(displayWidth * pixelRatio);
  const height = Math.floor(displayHeight * pixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.clearRect(0, 0, width, height);
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#10251e');
  background.addColorStop(0.55, '#163a2f');
  background.addColorStop(1, '#0b1210');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  if (idle) {
    frequencyData.fill(audioSpectrumMinimumDecibels);
    waveformData.fill(128);
  } else {
    analyser.getFloatFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(waveformData);
  }

  if (mode !== 'waveform') {
    const barCount = 72;
    // 使用整數像素邊界，避免浮點數 fillRect 造成個別柱受到不同程度的抗鋸齒。
    const gap = Math.max(1, Math.round(Math.max(2 * pixelRatio, width * 0.0025)));
    const barWidth = Math.max(1, Math.floor((width - gap * (barCount - 1)) / barCount));
    const amplitudes = calculateLogSpectrumAmplitudes(frequencyData, analyser.context.sampleRate, analyser.fftSize, barCount, idle);
    // Colors 開啟時讓柱狀頻譜的色相緩慢流動；關閉時維持固定綠色。
    const colorPhase = performance.now() * 0.00035;
    // 擴大至包含橘、黃、綠、青、藍與紫藍色系。
    const hueShift = colorsEnabled ? Math.sin(colorPhase) * 105 : 0;
    const barGradient = context.createLinearGradient(0, height, 0, 0);
    barGradient.addColorStop(0, `hsla(${150 + hueShift}, 55%, 48%, 0.9)`);
    barGradient.addColorStop(0.55, `hsla(${164 + hueShift}, 58%, 64%, 0.9)`);
    barGradient.addColorStop(1, `hsla(${145 + hueShift}, 70%, 88%, 0.96)`);
    context.fillStyle = barGradient;
    for (let index = 0; index < barCount; index += 1) {
      const amplitude = amplitudes[index];
      // 不為零振幅補畫固定高度，避免把 FFT 噪聲底線誤認成高頻能量。
      if (amplitude <= 0) {
        continue;
      }
      const barHeight = Math.max(1 * pixelRatio, amplitude * height * 0.78);
      const x = index * (barWidth + gap);
      context.fillRect(x, height - barHeight, barWidth, barHeight);
    }
    if (mode === 'spectrum') {
      return;
    }
  }

  context.beginPath();
  context.lineWidth = Math.max(2 * pixelRatio, 1.5);
  context.strokeStyle = idle ? 'rgba(190, 235, 213, 0.28)' : 'rgba(205, 250, 226, 0.92)';
  context.shadowColor = 'rgba(78, 208, 151, 0.46)';
  context.shadowBlur = 10 * pixelRatio;
  const maximumWaveformPoints = Math.max(320, Math.min(1600, Math.floor(displayWidth * 1.5)));
  const waveformStride = Math.max(1, Math.floor(waveformData.length / maximumWaveformPoints));
  const waveformPointCount = Math.ceil(waveformData.length / waveformStride);
  let waveformPointIndex = 0;
  for (let index = 0; index < waveformData.length; index += waveformStride) {
    const x = waveformPointIndex * width / Math.max(1, waveformPointCount - 1);
    const y = idle ? height * 0.46 : (waveformData[index] / 255) * height * 0.54 + height * 0.18;
    if (waveformPointIndex === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
    waveformPointIndex += 1;
  }
  context.stroke();
}

function formatMediaTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '00:00';
  }
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
