import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ViewerMode, ZoomBehavior } from './types';
import { buildImageDisplayLayout, calculateViewportScale, clampZoom } from './imageLayout';

interface UseImageViewerOptions {
  zoomBehavior: ZoomBehavior;
  // fullscreen 與 imageId 改變都會讓版面重排，需要重新置中。
  fullscreen: boolean;
  imageId: string | undefined;
  // panEnabled 為 false 時（沒有圖片）不接受拖曳平移。
  panEnabled: boolean;
}

// useImageViewer 管理圖片檢視的縮放、旋轉、拖曳平移與舞台尺寸，畫面只需要套用回傳的樣式與事件。
export function useImageViewer({ zoomBehavior, fullscreen, imageId, panEnabled }: UseImageViewerOptions) {
  const [viewerMode, setViewerMode] = useState<ViewerMode>('fit');
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLElement | null>(null);
  const dragPanRef = useRef({
    active: false,
    pointerId: 0,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const updateStageSize = () => {
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    };
    updateStageSize();

    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(stage);
    window.addEventListener('resize', updateStageSize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateStageSize);
    };
    // 舞台元素會隨著全螢幕切換與圖片載入重新掛載，必須重新綁定觀察器。
  }, [fullscreen, imageId]);

  const centerImage = () => {
    window.requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) {
        return;
      }
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
    });
  };

  useEffect(() => {
    centerImage();
  }, [fullscreen, imageId, naturalSize.height, naturalSize.width, rotation, viewerMode, zoom, zoomBehavior]);

  // resetView 會在切換圖片時把視角回到預設；lockRatio 刻意保留使用者原本的縮放。
  const resetView = () => {
    setRotation(0);
    if (zoomBehavior !== 'lockRatio') {
      setZoom(1);
    }
    setNaturalSize({ width: 0, height: 0 });
  };

  const resetZoom = () => {
    setZoom(1);
  };

  const changeZoom = (delta: number) => {
    if (viewerMode === 'fit') {
      const fitZoom = calculateViewportScale(naturalSize, stageSize, zoomBehavior, rotation) * zoom;
      setViewerMode('actual');
      setZoom(clampZoom(Math.round((fitZoom + delta) * 100) / 100));
      return;
    }
    setZoom((current) => clampZoom(Math.round((current + delta) * 100) / 100));
  };

  const rotateQuarterTurn = () => {
    setRotation((current) => (current + 90) % 360);
  };

  const handlePanStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (!panEnabled || event.button !== 0) {
      return;
    }

    const stage = event.currentTarget;
    const canPan = stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight;
    if (!canPan) {
      return;
    }

    dragPanRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
    };
    stage.setPointerCapture(event.pointerId);
    setPanning(true);
    event.preventDefault();
  };

  const handlePanMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragPanRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }

    const stage = event.currentTarget;
    stage.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    stage.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
    event.preventDefault();
  };

  const handlePanEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragPanRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragPanRef.current.active = false;
    setPanning(false);
  };

  const displayLayout = buildImageDisplayLayout(viewerMode, zoomBehavior, naturalSize, stageSize, zoom, rotation);
  const displayZoom = viewerMode === 'fit'
    ? calculateViewportScale(naturalSize, stageSize, zoomBehavior, rotation) * zoom
    : zoom;

  return {
    viewerMode,
    setViewerMode,
    rotation,
    rotateQuarterTurn,
    zoom,
    displayZoom,
    changeZoom,
    resetZoom,
    centerImage,
    panning,
    naturalSize,
    setNaturalSize,
    stageRef,
    displayLayout,
    resetView,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
  };
}
