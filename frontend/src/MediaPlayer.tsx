import { useEffect, useRef, useState } from 'react';
import type { ImageEntry } from './types';
import { convertSubtitleToWebVTT, subtitleLanguageFromName } from './mediaSupport';

interface MediaPlayerLabels {
  loading: string;
  playbackFailed: string;
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
}

interface MediaPlayerProps {
  entry: ImageEntry;
  subtitle: ImageEntry | null;
  labels: MediaPlayerLabels;
}

export function MediaPlayer({ entry, subtitle, labels }: MediaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoFrameRef = useRef<HTMLDivElement>(null);
  const [mediaURL, setMediaURL] = useState('');
  const [subtitleURL, setSubtitleURL] = useState('');
  const [error, setError] = useState('');
  const [subtitleError, setSubtitleError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setMediaURL('');
    setError('');
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    void window.go?.app?.App?.PrepareMediaByPath?.(entry.path)
      .then((url) => {
        if (!cancelled && url) {
          setMediaURL(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(labels.playbackFailed);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.path, labels.playbackFailed]);

  useEffect(() => {
    let cancelled = false;
    let objectURL = '';
    setSubtitleURL('');
    setSubtitleError('');
    if (entry.kind !== 'video' || !subtitle) {
      return () => undefined;
    }
    void window.go?.app?.App?.LoadDocumentByPath?.(subtitle.path)
      .then((payload) => {
        if (cancelled || !payload) {
          return;
        }
        const webVTT = convertSubtitleToWebVTT(payload.text, payload.format);
        if (!webVTT) {
          setSubtitleError(labels.subtitleFailed);
          return;
        }
        objectURL = URL.createObjectURL(new Blob([webVTT], { type: 'text/vtt;charset=utf-8' }));
        setSubtitleURL(objectURL);
      })
      .catch(() => {
        if (!cancelled) {
          setSubtitleError(labels.subtitleFailed);
        }
      });
    return () => {
      cancelled = true;
      if (objectURL) {
        URL.revokeObjectURL(objectURL);
      }
    };
  }, [entry.kind, labels.subtitleFailed, subtitle]);

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

  if (!mediaURL && !error) {
    return <div className="media-player-status">{labels.loading}</div>;
  }

  return (
    <div className={`media-player ${entry.kind}`}>
      {entry.kind === 'video' && mediaURL ? (
        <div ref={videoFrameRef} className="video-player-frame">
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
            onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
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
            {subtitle && subtitleURL ? (
              <track
                key={subtitleURL}
                kind="subtitles"
                src={subtitleURL}
                srcLang={subtitleLanguageFromName(subtitle.name)}
                label={subtitle.name}
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
            {subtitle && subtitleURL ? (
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
          <strong>{entry.name}</strong>
          <audio key={mediaURL} controls preload="metadata" src={mediaURL} onError={() => setError(labels.playbackFailed)} />
        </div>
      ) : null}
      {error ? <div className="media-playback-error">{error}</div> : null}
      {subtitleError ? <div className="media-subtitle-error">{subtitleError}</div> : null}
    </div>
  );
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
