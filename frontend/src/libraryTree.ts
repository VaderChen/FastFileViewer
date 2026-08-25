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
