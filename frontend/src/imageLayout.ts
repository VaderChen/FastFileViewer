import type { CSSProperties } from 'react';
import type { ViewerMode, ZoomBehavior } from './types';

interface Size {
  width: number;
  height: number;
}

export interface ImageDisplayLayout {
  imageStyle: CSSProperties;
  surfaceStyle: CSSProperties;
}

export function buildImageDisplayLayout(
  viewerMode: ViewerMode,
  zoomBehavior: ZoomBehavior,
  naturalSize: Size,
  stageSize: Size,
  zoom: number,
  rotation: number,
): ImageDisplayLayout {
  const normalizedRotation = normalizeRotation(rotation);
  if (naturalSize.width <= 0 || naturalSize.height <= 0) {
    return {
      imageStyle: { transform: `rotate(${normalizedRotation}deg)` },
      surfaceStyle: {},
    };
  }

  const baseScale = viewerMode === 'fit'
    ? calculateViewportScale(naturalSize, stageSize, zoomBehavior, normalizedRotation)
    : 1;
  const displayScale = Math.max(0.01, baseScale * zoom);
  const imageWidth = naturalSize.width * displayScale;
  const imageHeight = naturalSize.height * displayScale;
  const quarterTurn = normalizedRotation === 90 || normalizedRotation === 270;

  return {
    imageStyle: {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: imageWidth,
      height: imageHeight,
      maxWidth: 'none',
      maxHeight: 'none',
      margin: 0,
      transform: `translate(-50%, -50%) rotate(${normalizedRotation}deg)`,
    },
    surfaceStyle: {
      width: quarterTurn ? imageHeight : imageWidth,
      height: quarterTurn ? imageWidth : imageHeight,
      flex: '0 0 auto',
    },
  };
}

export function calculateViewportScale(
  naturalSize: Size,
  stageSize: Size,
  zoomBehavior: ZoomBehavior,
  rotation = 0,
): number {
  if (naturalSize.width <= 0 || naturalSize.height <= 0 || stageSize.width <= 0 || stageSize.height <= 0) {
    return 1;
  }
  if (zoomBehavior === 'lockRatio') {
    return 1;
  }

  const normalizedRotation = normalizeRotation(rotation);
  const quarterTurn = normalizedRotation === 90 || normalizedRotation === 270;
  const visualWidth = quarterTurn ? naturalSize.height : naturalSize.width;
  const visualHeight = quarterTurn ? naturalSize.width : naturalSize.height;
  const fitScale = Math.min(stageSize.width / visualWidth, stageSize.height / visualHeight);
  if (zoomBehavior === 'shrinkLarge') {
    return Math.min(1, fitScale);
  }
  return fitScale;
}

// clampZoom 會把縮放限制在工具列允許的範圍內。
export function clampZoom(value: number): number {
  return Math.min(8, Math.max(0.1, value));
}

function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}
