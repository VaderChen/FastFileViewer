import { useEffect, useRef, useState } from 'react';
import type { ImageEntry } from './types';
import {
  audioSpectrumMaximumDecibels,
  audioSpectrumMinimumDecibels,
  calculateLogSpectrumAmplitudes,
  convertSubtitleToWebVTT,
  sidecarSubtitlePaths,
  subtitleLanguageFromName,
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
  const [subtitleTrackName, setSubtitleTrackName] = useState('');
  const [error, setError] = useState('');
  const [subtitleError, setSubtitleError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
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
    setSubtitleTrackName('');
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
          objectURL = URL.createObjectURL(new Blob([webVTT], { type: 'text/vtt;charset=utf-8' }));
          setSubtitleTrackName(payload.name || subtitle?.name || subtitlePath.split(/[\\/]/).pop() || 'subtitle.vtt');
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
  }, [entry.kind, entry.path, labels.subtitleFailed, subtitle]);

  useEffect(() => {
    const textTrack = videoRef.current?.textTracks[0];
    if (textTrack) {
      textTrack.mode = subtitlesEnabled ? 'showing' : 'disabled';
    }
  }, [subtitleURL, subtitlesEnabled]);

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

  const enterFullscreen = async () => {
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!video) {
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (videoFrameRef.current?.requestFullscreen) {
      await videoFrameRef.current.requestFullscreen().catch(() => undefined);
      return;
    }
    video.webkitEnterFullscreen?.();
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
            {subtitleURL ? (
              <track
                key={subtitleURL}
                kind="subtitles"
                src={subtitleURL}
                srcLang={subtitleLanguageFromName(subtitleTrackName)}
                label={subtitleTrackName}
                default
                onLoad={(event) => {
                  event.currentTarget.track.mode = subtitlesEnabled ? 'showing' : 'disabled';
                }}
              />
            ) : null}
          </video>
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
                className={subtitlesEnabled ? 'active' : ''}
                type="button"
                title={subtitlesEnabled ? labels.subtitlesOff : labels.subtitlesOn}
                aria-label={subtitlesEnabled ? labels.subtitlesOff : labels.subtitlesOn}
                onClick={() => setSubtitlesEnabled((current) => !current)}
              >
                CC
              </button>
            ) : null}
            <button type="button" title={labels.fullscreen} aria-label={labels.fullscreen} onClick={() => void enterFullscreen()}>
              <span aria-hidden="true">⛶</span>
            </button>
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
