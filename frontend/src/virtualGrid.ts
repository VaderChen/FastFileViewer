// 與 CSS 共用固定卡片高度；只掛載視窗及前後兩列。
export const thumbnailRowHeight = 224;
export const thumbnailGap = 14;
export const thumbnailPadding = 18;

export function virtualGridRange(count: number, width: number, height: number, scrollTop: number) {
  const columns = Math.max(1, Math.floor((width - thumbnailPadding * 2 + thumbnailGap) / (180 + thumbnailGap)));
  const stride = thumbnailRowHeight + thumbnailGap;
  const rows = Math.ceil(count / columns);
  const first = Math.max(0, Math.min(rows - 1, Math.floor(Math.max(0, scrollTop - thumbnailPadding) / stride)) - 2);
  const last = Math.min(rows, Math.ceil((Math.max(0, scrollTop - thumbnailPadding) + height) / stride) + 2);
  return { columns, start: first * columns, end: Math.min(count, last * columns), offset: first * stride,
    totalHeight: Math.max(0, rows * stride - thumbnailGap) };
}
