import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ImageEntry } from './types';
import { thumbnailGap, thumbnailPadding, thumbnailRowHeight, virtualGridRange } from './virtualGrid';

interface Props {
  images: ImageEntry[];
  resetKey: string;
  renderItem: (image: ImageEntry) => ReactNode;
  children: ReactNode;
}

export function VirtualThumbnailGrid({ images, resetKey, renderItem, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, top: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setViewport({ width: element.clientWidth, height: element.clientHeight, top: element.scrollTop });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    element.addEventListener('scroll', schedule, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
    };
  }, []);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setViewport((current) => ({ ...current, top: 0 }));
  }, [resetKey]);
  const range = virtualGridRange(images.length, viewport.width, viewport.height, viewport.top);
  return (
    <div className="thumbnail-grid" ref={ref} style={{ padding: thumbnailPadding }}>
      <div style={{ height: range.totalHeight, position: 'relative' }}>
        <div className="thumbnail-grid-window" style={{ position: 'absolute', top: range.offset, left: 0, right: 0,
          display: 'grid', gridTemplateColumns: `repeat(${range.columns}, minmax(0, 1fr))`,
          gridAutoRows: thumbnailRowHeight, gap: thumbnailGap }}>
          {images.slice(range.start, range.end).map(renderItem)}
        </div>
      </div>
      {children}
    </div>
  );
}
