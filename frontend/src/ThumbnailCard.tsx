import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBoxArchive, faCheck, faFileLines, faFolder, faImage, faSpinner } from '@fortawesome/free-solid-svg-icons';
import type { ImageEntry } from './types';
import { formatBytes } from './format';
import { observeThumbnailVisibility, readThumbnail, storeThumbnail } from './thumbnailCache';

interface ThumbnailCardProps {
  image: ImageEntry;
  active: boolean;
  selected: boolean;
  archiveLabel: string;
  folderLabel: string;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
}

export function ThumbnailCard({ image, active, selected, archiveLabel, folderLabel, onToggle, onOpen }: ThumbnailCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(image.kind !== 'image');
  const [thumbnail, setThumbnail] = useState(() => readThumbnail(image.path));
  const [thumbnailStatus, setThumbnailStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>(() => thumbnail ? 'ready' : 'idle');

  useEffect(() => {
    if (image.kind !== 'image' || visible) {
      return;
    }
    const card = cardRef.current;
    if (!card) {
      return;
    }
    return observeThumbnailVisibility(card, () => setVisible(true));
  }, [image.kind, visible]);

  useEffect(() => {
    if (image.kind !== 'image' || !visible) {
      setThumbnail('');
      return;
    }
    const cached = readThumbnail(image.path);
    if (cached) {
      setThumbnail(cached);
      setThumbnailStatus('ready');
      return;
    }
    let cancelled = false;
    setThumbnailStatus('loading');
    void window.go?.app?.App?.LoadThumbnailByPath?.(image.path, 280)
      .then((payload) => {
        if (!cancelled && payload?.dataUri) {
          storeThumbnail(image.path, payload.dataUri);
          setThumbnail(payload.dataUri);
          setThumbnailStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setThumbnailStatus('failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [image.kind, image.path, visible]);

  return (
    <article ref={cardRef} className={`thumbnail-card ${active ? 'active' : ''} ${selected ? 'selected' : ''}`} onDoubleClick={onOpen}>
      <button className="thumbnail-select" type="button" onClick={onToggle} aria-pressed={selected}>
        {selected ? <FontAwesomeIcon icon={faCheck} /> : null}
      </button>
      <button className="thumbnail-preview" type="button" onClick={onOpen}>
        {image.kind !== 'image' ? (
          <div className={`document-thumbnail ${image.kind}`}>
            <FontAwesomeIcon icon={faFileLines} />
            <strong>{image.format.replace('.', '').toUpperCase()}</strong>
          </div>
        ) : thumbnailStatus === 'ready' && thumbnail ? <img src={thumbnail} alt="" draggable={false} loading="lazy" />
          : thumbnailStatus === 'loading' ? <FontAwesomeIcon icon={faSpinner} spin />
            : <FontAwesomeIcon icon={faImage} />}
      </button>
      <div className="thumbnail-details">
        <strong title={image.name}>{image.name}</strong>
        <span>
          <FontAwesomeIcon icon={image.source === 'archive' ? faBoxArchive : faFolder} />
          {image.source === 'archive' ? archiveLabel : folderLabel} · {formatBytes(image.size)}
        </span>
      </div>
    </article>
  );
}
