// 後端可取消操作共用的錯誤判讀，前端各領域都靠這裡解讀 Wails 回傳的錯誤。
const cancelledOperationMessage = '操作已取消';

export function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === 'string') {
    return error || fallback;
  }
  return fallback;
}

export function isOperationCancelled(error: unknown): boolean {
  return extractErrorMessage(error, '').includes(cancelledOperationMessage);
}
