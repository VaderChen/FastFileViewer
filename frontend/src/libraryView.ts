import type { ImageEntry, LibraryNode } from './types';

export interface ImageNavigationItem {
  image: ImageEntry;
  node: LibraryNode;
  ancestorIds: string[];
}

// Library updates replace changed nodes. Weak keys let discarded trees be collected.
const visibleNodes = new WeakMap<LibraryNode, LibraryNode | null>();
const nodeCounts = new WeakMap<LibraryNode, LibraryCounts>();

interface LibraryCounts {
  entries: number;
  images: number;
  documents: number;
  media: number;
  archives: number;
}

export function buildVisibleTree(node: LibraryNode | null, isRoot = true): LibraryNode | null {
  if (!node) return null;
  if (!visibleNodes.has(node)) {
    let children: LibraryNode[] | undefined;
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index];
      const visible = buildVisibleTree(child, false);
      if (visible !== child && !children) children = node.children.slice(0, index);
      if (visible && children) children.push(visible);
    }
    const result = children ? { ...node, children } : node;
    visibleNodes.set(node, !result.images.length && !result.children.length && result.scanned ? null : result);
  }
  const visible = visibleNodes.get(node)!;
  // The root remains visible even when all scanned descendants are empty.
  return visible ?? (isRoot ? (node.children.length ? { ...node, children: [] } : node) : null);
}

// Append once per entry instead of copying every descendant array at each level.
export function collectImages(node: LibraryNode): ImageEntry[] {
  const images: ImageEntry[] = [];
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of current.images) images.push(entry);
    for (let index = current.children.length - 1; index >= 0; index--) pending.push(current.children[index]);
  }
  return images;
}

export function collectImageRefs(node: LibraryNode): ImageNavigationItem[] {
  const images: ImageNavigationItem[] = [];
  const pending: { node: LibraryNode; ancestorIds: string[]; nextChild: number; childAncestorIds?: string[] }[] = [
    { node, ancestorIds: [], nextChild: 0 },
  ];
  while (pending.length) {
    const frame = pending[pending.length - 1];
    if (frame.nextChild < frame.node.children.length) {
      const child = frame.node.children[frame.nextChild++];
      frame.childAncestorIds ??= [...frame.ancestorIds, frame.node.id];
      pending.push({ node: child, ancestorIds: frame.childAncestorIds, nextChild: 0 });
    } else {
      for (const image of frame.node.images) images.push({ image, node: frame.node, ancestorIds: frame.ancestorIds });
      pending.pop();
    }
  }
  return images;
}

export function libraryCounts(node: LibraryNode): LibraryCounts {
  const cached = nodeCounts.get(node);
  if (cached) return cached;
  const counts = { entries: node.images.length, images: 0, documents: 0, media: 0, archives: node.kind === 'archive' ? 1 : 0 };
  for (const entry of node.images) {
    if (entry.kind === 'image') counts.images++;
    else if (entry.kind === 'video' || entry.kind === 'audio' || entry.kind === 'subtitle') counts.media++;
    else counts.documents++;
  }
  for (const child of node.children) {
    const childCounts = libraryCounts(child);
    counts.entries += childCounts.entries;
    counts.images += childCounts.images;
    counts.documents += childCounts.documents;
    counts.media += childCounts.media;
    counts.archives += childCounts.archives;
  }
  nodeCounts.set(node, counts);
  return counts;
}

export function containsSelectedImage(node: LibraryNode, selectedId: string, selectedIds: ReadonlySet<string>): boolean {
  if (!selectedId && selectedIds.size === 0) return false;
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.images.some((entry) => entry.id === selectedId || selectedIds.has(entry.id))) return true;
    for (const child of current.children) pending.push(child);
  }
  return false;
}

// Keep selection insertion order and the existing first-entry fallback. Only
// collect selected IDs, instead of allocating an ID index for the whole view.
export function reconcileVisibleSelection(images: readonly ImageEntry[], selectedIds: ReadonlySet<string>): Set<string> {
  if (!images.length) return new Set();
  if (!selectedIds.size) return new Set([images[0].id]);
  const visible = new Set<string>();
  for (const image of images) {
    if (selectedIds.has(image.id)) visible.add(image.id);
    if (visible.size === selectedIds.size) break;
  }
  const next = new Set<string>();
  for (const id of selectedIds) {
    if (visible.has(id)) next.add(id);
  }
  return next.size ? next : new Set([images[0].id]);
}

// Keep the existing +1, -1, +2, -2 image-only prefetch order without flattening
// and filtering the entire navigation list every time the current image changes.
export function imagePrefetchCandidates(navigation: ImageNavigationItem[], selected: ImageEntry): ImageEntry[] {
  const current = navigation.findIndex(item => item.image.kind === 'image' && item.image.id === selected.id);
  if (current < 0) return [];
  const neighbors = (direction: number) => {
    const found: ImageEntry[] = [];
    for (let step = 1; step <= navigation.length && found.length < 2; step++) {
      const entry = navigation[(current + direction * step + navigation.length) % navigation.length].image;
      if (entry.kind === 'image') found.push(entry);
    }
    return found;
  };
  const forward = neighbors(1), backward = neighbors(-1);
  const result: ImageEntry[] = [];
  for (const entry of [forward[0], backward[0], forward[1], backward[1]]) {
    if (entry && !(entry.path === selected.path && entry.size === selected.size)
      && !result.some(other => other.path === entry.path && other.size === entry.size)) result.push(entry);
  }
  return result;
}
