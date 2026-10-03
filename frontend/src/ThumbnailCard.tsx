import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBoxArchive, faCheck, faFileLines, faFolder, faImage, faSpinner } from '@fortawesome/free-solid-svg-icons';
import type { ImageEntry } from './types';
import { formatBytes } from './format';
import { observeThumbnailVisibility, readThumbnail, requestThumbnail } from './thumbnailCache';

interface ThumbnailCardProps {
  image: ImageEntry;
  revision?: number;
  active: boolean;
  selected: boolean;
  archiveLabel: string;
  folderLabel: string;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
}

export function ThumbnailCard({ image, revision = 0, active, selected, archiveLabel, folderLabel, onToggle, onOpen }: ThumbnailCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(image.kind !== 'image');
  const [preview, setPreview] = useState<{ path: string; revision: number; dataUri: string; status: 'idle' | 'loading' | 'ready' | 'failed' }>(() => {
    const cached = readThumbnail(image.path);
    return { path: image.path, revision, dataUri: cached, status: cached ? 'ready' : 'idle' };
  });
  const previewIsCurrent = preview.path === image.path && preview.revision === revision;
  const thumbnail = previewIsCurrent ? preview.dataUri : '';
  const thumbnailStatus = previewIsCurrent ? preview.status : 'idle';

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
      setPreview({ path: image.path, revision, dataUri: '', status: 'idle' });
      return;
    }
    const cached = readThumbnail(image.path);
    if (cached) {
      setPreview({ path: image.path, revision, dataUri: cached, status: 'ready' });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPreview({ path: image.path, revision, dataUri: '', status: 'loading' });
    void requestThumbnail(image.path, controller.signal)
      .then((dataUri) => {
        if (!cancelled) {
          setPreview({ path: image.path, revision, dataUri, status: 'ready' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview({ path: image.path, revision, dataUri: '', status: 'failed' });
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [image.kind, image.path, revision, visible]);

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
