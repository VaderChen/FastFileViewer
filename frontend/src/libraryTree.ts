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
