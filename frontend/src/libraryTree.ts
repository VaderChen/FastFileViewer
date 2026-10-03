import type { ImageEntry, LibraryNode } from './types';

// replaceLibraryEntry 會把樹狀清單裡的指定項目換成新檔案，未受影響的節點維持原本的參考以避免多餘重繪。
export function replaceLibraryEntry(node: LibraryNode, replacedEntryId: string, replacement: ImageEntry): LibraryNode {
  const replacedIndex = node.images.findIndex((entry) => entry.id === replacedEntryId);
  const children = node.children.map((child) => replaceLibraryEntry(child, replacedEntryId, replacement));
  const childrenChanged = children.some((child, position) => child !== node.children[position]);
  if (replacedIndex < 0 && !childrenChanged) {
    return node;
  }
  const images = replacedIndex < 0
    ? node.images
    : [
      ...node.images.slice(0, replacedIndex),
      replacement,
      ...node.images.slice(replacedIndex + 1),
    ];
  return { ...node, images, children };
}

// removeLibraryEntries 只複製實際受影響的分支，避免檔案操作後整棵樹失去參考相等性。
export function removeLibraryEntries(node: LibraryNode, removedEntryIds: ReadonlySet<string>): LibraryNode {
  if (removedEntryIds.size === 0) {
    return node;
  }
  const images = node.images.filter((entry) => !removedEntryIds.has(entry.id));
  const children = node.children.map((child) => removeLibraryEntries(child, removedEntryIds));
  const childrenChanged = children.some((child, index) => child !== node.children[index]);
  if (images.length === node.images.length && !childrenChanged) {
    return node;
  }
  return { ...node, images, children };
}

// 同批掃描結果只遍歷一次樹，未受影響的分支維持參考相等性。
export function mergeScannedNodes(current: LibraryNode, scanned: LibraryNode[]): LibraryNode {
  const updates = new Map(scanned.map((node) => [node.id, node]));
  const merge = (node: LibraryNode): LibraryNode => {
    const replacement = updates.get(node.id);
    let base = node;
    if (replacement) {
      const existingChildren = new Map(node.children.map((child) => [child.id, child]));
      base = {
        ...replacement,
        children: replacement.children.map((child) => {
          const existing = existingChildren.get(child.id);
          return existing && child.kind === 'directory' && !child.scanned
            ? { ...child, scanned: existing.scanned, images: existing.images, children: existing.children }
            : child;
        }),
      };
    }
    const children = base.children.map(merge);
    return children.every((child, index) => child === base.children[index]) ? base : { ...base, children };
  };
  return merge(current);
}

// A move removes the old entry and inserts it only into its actual destination.
export function moveLibraryEntry(node: LibraryNode, oldId: string, replacement: ImageEntry): LibraryNode {
  const destination = node.kind === 'directory' && node.path === replacement.directoryPath;
  let images = node.images.filter((entry) => entry.id !== oldId && (!destination || entry.id !== replacement.id));
  if (destination) {
    images = [...images, replacement].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  const children = node.children.map((child) => moveLibraryEntry(child, oldId, replacement));
  if (!destination && images.length === node.images.length && children.every((child, index) => child === node.children[index])) return node;
  return { ...node, images, children };
}

// Validate persisted trees before recursive render/search helpers consume them.
export function isLibraryTree(value: unknown): value is LibraryNode {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const nodeIds = new Set<string>();
  const imageIds = new Set<string>();
  const entryKinds = new Set(['image', 'text', 'markdown', 'code', 'pdf', 'video', 'audio', 'subtitle']);
  const record = (item: unknown): item is Record<string, unknown> =>
    item !== null && typeof item === 'object' && !Array.isArray(item);
  const nonEmptyString = (item: unknown): item is string => typeof item === 'string' && item.length > 0;
  while (pending.length) {
    const { value: node, depth } = pending.pop()!;
    if (depth > 256 || !record(node)
      || !nonEmptyString(node.id) || nodeIds.has(node.id)
      || typeof node.name !== 'string' || !nonEmptyString(node.path)
      || (node.kind !== 'directory' && node.kind !== 'archive')
      || typeof node.scanned !== 'boolean'
      || !Array.isArray(node.images) || !Array.isArray(node.children)) return false;
    nodeIds.add(node.id);
    for (const entry of node.images) {
      if (!record(entry) || !nonEmptyString(entry.id) || imageIds.has(entry.id)
        || typeof entry.name !== 'string' || !nonEmptyString(entry.path)
        || typeof entry.directoryPath !== 'string' || typeof entry.format !== 'string'
        || typeof entry.kind !== 'string' || !entryKinds.has(entry.kind)
        || typeof entry.size !== 'number' || !Number.isFinite(entry.size) || entry.size < 0
        || (entry.source !== 'file' && entry.source !== 'archive')
        || (entry.source === 'archive' && (!nonEmptyString(entry.archivePath) || !nonEmptyString(entry.innerPath)))) return false;
      imageIds.add(entry.id);
    }
    for (const child of node.children) pending.push({ value: child, depth: depth + 1 });
  }
  return true;
}
