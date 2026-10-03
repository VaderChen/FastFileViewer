import type { LocaleCode } from './types';

export interface AppRelease {
  tag: string;
  version: string;
  notes: string;
  url: string;
  size: number;
}

export interface AppUpdateState {
  phase: 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'verifying' | 'preparing' | 'restarting' | 'error' | 'cancelled';
  currentVersion: string;
  release?: AppRelease;
  bytes: number;
  error: string;
  installError: string;
}

export interface AppUpdateAPI {
  FrontendReady(): Promise<void>;
  GetUpdateState(): Promise<AppUpdateState>;
  GetUpdateProgress(): Promise<Omit<AppUpdateState, 'release'> & { releaseTag: string }>;
  CheckForUpdates(): Promise<AppUpdateState>;
  InstallUpdate(locale: string): Promise<AppUpdateState>;
  CancelUpdate(): Promise<AppUpdateState>;
}

export function reconcileAppUpdateState(previous: AppUpdateState, next: AppUpdateState): AppUpdateState {
  const a = previous.release, b = next.release;
  const sameRelease = a === b || Boolean(a && b && a.tag === b.tag && a.version === b.version
    && a.notes === b.notes && a.url === b.url && a.size === b.size);
  return sameRelease && previous.phase === next.phase && previous.currentVersion === next.currentVersion
    && previous.bytes === next.bytes && previous.error === next.error && previous.installError === next.installError
    ? previous : next;
}

export function updateBusy(phase: AppUpdateState['phase']) {
  return ['checking', 'downloading', 'verifying', 'preparing', 'restarting'].includes(phase);
}

export function updatePercent(state: AppUpdateState): number | undefined {
  if (state.phase === 'downloading' && state.release?.size) {
    return Math.min(65, Math.max(0, Math.floor(state.bytes / state.release.size * 65)));
  }
  if (state.phase === 'verifying') return 65;
  if (state.phase === 'preparing') return 70;
  if (state.phase === 'restarting') return 80;
  return undefined;
}

export const updateMessages = {
  'zh-TW': {
    check: '偵測更新', title: '軟體更新', available: '有新版本可供更新', checking: '正在偵測新版…',
    current: '目前已是最新版本', downloading: '正在下載更新…', verifying: '正在驗證安裝包…',
    preparing: '正在準備安裝…', restarting: '正在啟動更新程式…', cancelled: '更新已取消',
    currentVersion: '目前版本', newVersion: '新版本', install: '更新並重新啟動', later: '稍後', close: '關閉', cancel: '取消更新',
    explanation: '更新下載完成後，程式會自動關閉、安裝並重新啟動。進行中的工作會停止。',
    errors: {
      network: '無法連線至 GitHub，請確認網路連線後再試一次。', rate_limited: 'GitHub 暫時限制偵測次數，請稍後再試。',
      version: '開發版本無法比較更新，請使用正式發行版本。', invalid_release: '發行資訊不完整，請稍後再試。',
      missing_asset: '此版本尚未提供 Apple Silicon 安裝包。', checksum: '安裝包完整性驗證失敗，請重新下載。',
      signature: '安裝包簽章或發行者驗證失敗，更新已停止。', unsupported: '自動更新需要正式簽署的 macOS App。',
      not_writable: '請將 App 移至可寫入的「應用程式」資料夾，重新開啟後再更新。',
      install: '無法準備更新，原版本仍保留。請再試一次。', restart: '無法啟動更新程式，請再試一次。',
      system_version: '新版需要較新的 macOS，請先更新作業系統。', cancelled: '更新已取消。',
    },
  },
  en: {
    check: 'Check for Updates', title: 'Software Update', available: 'A new version is available', checking: 'Checking for updates…',
    current: 'You are up to date', downloading: 'Downloading update…', verifying: 'Verifying update…',
    preparing: 'Preparing installation…', restarting: 'Starting installer…', cancelled: 'Update cancelled',
    currentVersion: 'Current version', newVersion: 'New version', install: 'Update and Restart', later: 'Later', close: 'Close', cancel: 'Cancel Update',
    explanation: 'After downloading, the app will close, install the update, and restart automatically. Work in progress will stop.',
    errors: {
      network: 'Could not connect to GitHub. Check your connection and try again.', rate_limited: 'GitHub is temporarily limiting update checks. Try again later.',
      version: 'Updates cannot be compared for a development build. Use a published version.', invalid_release: 'The release information is incomplete. Try again later.',
      missing_asset: 'An Apple Silicon installer is not yet available for this release.', checksum: 'The download failed its integrity check. Please download it again.',
      signature: 'The update signature or publisher could not be verified. Installation stopped.', unsupported: 'Automatic updates require an officially signed macOS app.',
      not_writable: 'Move the app to a writable Applications folder, reopen it, and try again.',
      install: 'Could not prepare the update. The original app is preserved. Please try again.', restart: 'Could not start the installer. Please try again.',
      system_version: 'This release requires a newer macOS version. Update macOS first.', cancelled: 'Update cancelled.',
    },
  },
  ja: {
    check: 'アップデートを確認', title: 'ソフトウェア更新', available: '新しいバージョンがあります', checking: '更新を確認中…',
    current: '最新バージョンです', downloading: '更新をダウンロード中…', verifying: '更新を検証中…',
    preparing: 'インストールを準備中…', restarting: '更新プログラムを起動中…', cancelled: '更新をキャンセルしました',
    currentVersion: '現在のバージョン', newVersion: '新しいバージョン', install: '更新して再起動', later: '後で', close: '閉じる', cancel: '更新をキャンセル',
    explanation: 'ダウンロード後、アプリを終了して更新をインストールし、自動で再起動します。進行中の作業は停止します。',
    errors: {
      network: 'GitHub に接続できません。ネットワークを確認して再試行してください。', rate_limited: 'GitHub のアクセス制限中です。しばらくしてから再試行してください。',
      version: '開発版では更新を比較できません。正式なリリース版を使用してください。', invalid_release: 'リリース情報が不完全です。後で再試行してください。',
      missing_asset: 'このリリースの Apple Silicon インストーラーはまだありません。', checksum: 'ダウンロードの整合性検証に失敗しました。もう一度ダウンロードしてください。',
      signature: '更新の署名または発行元を確認できません。更新を停止しました。', unsupported: '自動更新には正式に署名された macOS アプリが必要です。',
      not_writable: 'アプリを書き込み可能な「アプリケーション」フォルダに移動し、再起動してから更新してください。',
      install: '更新を準備できません。以前のアプリは保存されています。再試行してください。', restart: '更新プログラムを起動できません。再試行してください。',
      system_version: 'このリリースには新しい macOS が必要です。先に OS を更新してください。', cancelled: '更新をキャンセルしました。',
    },
  },
} satisfies Record<LocaleCode, object>;

export function updateErrorMessage(code: string, locale: LocaleCode) {
  const errors: Record<string, string> = updateMessages[locale].errors;
  return errors[code] ?? errors.network;
}
