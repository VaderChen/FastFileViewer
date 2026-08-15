import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import hljs from 'highlight.js/lib/common';
import 'github-markdown-css/github-markdown.css';
import githubDarkThemeUrl from 'highlight.js/styles/github-dark.css?url';
import githubLightThemeUrl from 'highlight.js/styles/github.css?url';
import atomOneDarkThemeUrl from 'highlight.js/styles/atom-one-dark.css?url';
import nordThemeUrl from 'highlight.js/styles/nord.css?url';
import monokaiThemeUrl from 'highlight.js/styles/monokai.css?url';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faAngleDown,
  faAngleLeft,
  faAngleRight,
  faArrowsToEye,
  faBoxArchive,
  faCheck,
  faClone,
  faCompress,
  faExpand,
  faFileExport,
  faFileLines,
  faFolder,
  faFolderOpen,
  faGear,
  faImage,
  faMinus,
  faMagnifyingGlass,
  faPlus,
  faRotateRight,
  faSpinner,
  faStop,
  faTableCellsLarge,
  faThumbtack,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { ClipboardSetText, WindowFullscreen, WindowIsFullscreen, WindowSetTitle, WindowUnfullscreen } from '../wailsjs/runtime/runtime';
import type { AppInfo, BootstrapPayload, DocumentPayload, DocumentTheme, DuplicateGroup, ImageEntry, ImagePayload, LanguagePreference, LibraryNode, LocaleCode, SettingsTab, StageBackground, ViewerMode, ZoomBehavior } from './types';
import { blockMarkdownUrl, limitDocumentPreview, maxRenderedCodeLines, normalizeDocumentLineEndings } from './markdownSecurity';
import { DelimitedTableView, JsonStructuredView } from './structuredViewers';
import { filterWorkspaceEntries } from './workspaceFilters';
import type { WorkspaceKindFilter, WorkspaceSourceFilter } from './workspaceFilters';

const fallbackBootstrap: BootstrapPayload = {
  defaultPath: '',
  supportedImages: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tif', '.tiff', '.heic'],
  supportedDocuments: ['.txt', '.md', '.markdown'],
  supportedPacks: ['.zip', '.tar', '.tgz', '.tar.gz'],
};

const fallbackAppInfo: AppInfo = {
  hardwareInfo: '',
  osVersion: '',
  appVersion: '',
  commit: 'unknown',
  tag: 'untagged',
  buildState: 'unknown',
  sourceUrl: 'https://github.com/VaderChen/FastFileViewer',
  license: 'GNU General Public License v3.0',
};

const messages = {
  'zh-TW': {
    appName: '檔案工作台',
    documentCount: '份文件',
    contentCount: '個項目',
    loadingDocument: '讀取文件中',
    markdownPreview: 'Markdown 預覽',
    textPreview: '純文字預覽',
    codePreview: '程式碼預覽',
    workspace: '內容工作區',
    workspaceSubtitle: '跨資料夾與壓縮檔瀏覽圖片、文件及程式碼',
    selectedCount: '已選取',
    exportSelected: '匯出選取項目',
    exportDestination: '選擇匯出目錄',
    detectDuplicates: '偵測完全重複檔案',
    duplicateGroups: '重複群組',
    noDuplicates: '沒有找到完全相同的檔案',
    sourceArchive: '壓縮檔',
    sourceFolder: '資料夾',
    workspaceEmpty: '完成掃描後即可建立內容工作區',
    exportedSummary: '匯出完成',
    clearSelection: '清除選取',
    imageCount: '張圖片',
    archiveCount: '個壓縮檔',
    chooseDirectory: '選擇目錄',
    pathPlaceholder: '選擇或輸入內容目錄',
    scan: '掃描',
    stopScan: '停止掃描',
    supportPrefix: '圖片',
    archivePrefix: '壓縮檔',
    notScanned: '尚未掃描目錄',
    viewerTitle: '內容檢視',
    previous: '上一張',
    next: '下一張',
    fit: '符合視窗',
    actual: '原始大小',
    rotate: '旋轉',
    zoomIn: '放大',
    zoomOut: '縮小',
    fullscreen: '全螢幕',
    exitFullscreen: '離開全螢幕',
    loadingImage: '讀取內容中',
    pickImage: '請從左側選擇圖片或文件',
    noImage: '未選擇內容',
    selectPathFirst: '請先選擇或輸入圖片目錄',
    operationFailed: '操作失敗',
    cancelOperation: '取消作業',
    previewTruncated: '檔案過大，僅顯示前段內容',
    remoteContentBlocked: '已封鎖遠端內容',
    documentTheme: '文件配色',
    previewView: '預覽',
    rawView: '原始',
    invalidJson: 'JSON 格式無法解析',
    filterRows: '搜尋表格內容',
    noMatchingRows: '沒有符合的資料列',
    rows: '列',
    columns: '欄',
    structuredTruncated: '內容過多，已限制顯示數量',
    searchContent: '搜尋名稱、路徑或格式',
    allContent: '全部類型',
    imagesOnly: '只看圖片',
    documentsOnly: '只看文件',
    allSources: '全部來源',
    foldersOnly: '資料夾',
    archivesOnly: '壓縮檔',
    selectFiltered: '選取篩選結果',
    showingResults: '顯示結果',
    loadMore: '顯示更多',
    loadAll: '全部載入',
    loadingItems: '載入內容中',
    loadingItemsHint: '正在建立顯示項目，請稍候',
    calculateChecksum: '計算 SHA-256',
    copyChecksum: '複製 SHA-256',
    scanning: '掃描中',
    scannedDirectories: '已掃描目錄',
    pendingDirectories: '待掃描',
    expand: '展開',
    collapse: '收合',
    contextMenu: '操作選單',
    selectItem: '選取',
    copyName: '複製名稱',
    copyPath: '複製路徑',
    pinnedDirectories: '釘選目錄',
    currentDirectory: '當前目錄',
    noPinnedDirectories: '尚未釘選目錄',
    pinDirectory: '釘選目錄',
    unpinDirectory: '取消釘選',
    copyToClipboard: '複製到剪貼簿',
    copyImageLocation: '複製圖片位置',
    language: '語言',
    settings: '設定',
    display: '顯示',
    formats: '檔案格式',
    imageFormats: '影像檔案',
    documentFormats: '文件檔案',
    clearAll: '全不選',
    about: '關於',
    zoomBehavior: '縮放',
    zoomFitArea: '符合顯示區域',
    zoomShrinkLarge: '大於顯示區域才縮放',
    zoomLockRatio: '鎖定比例',
    automatic: '自動',
    stageBackground: '底色',
    backgroundLightGray: '淺灰',
    backgroundWhite: '白色',
    backgroundDarkGray: '深灰',
    backgroundBlack: '黑色',
    backgroundChecker: '透明格紋',
    close: '關閉',
    supportedFormats: '支援格式',
    selectAll: '全選',
    hardwareInfo: '硬體資訊',
    osVersion: 'OS 版本',
    appVersion: 'APP 版本',
    buildInfo: '建置來源',
    sourceCode: '原始碼',
    license: '授權',
    copySourceUrl: '複製 GitHub 網址',
    noWarranty: '本程式依 GPLv3 提供，不附帶任何擔保。完整授權與第三方通知包含於 App Bundle 的 Resources/Licenses。',
    unavailable: '無法取得',
  },
  en: {
    appName: 'FastFileViewer',
    documentCount: 'documents',
    contentCount: 'items',
    loadingDocument: 'Loading document',
    markdownPreview: 'Markdown preview',
    textPreview: 'Plain text preview',
    codePreview: 'Code preview',
    workspace: 'Content Workspace',
    workspaceSubtitle: 'Browse images, documents, and source code across folders and archives',
    selectedCount: 'Selected',
    exportSelected: 'Export selected items',
    exportDestination: 'Choose export folder',
    detectDuplicates: 'Detect exact duplicate files',
    duplicateGroups: 'Duplicate groups',
    noDuplicates: 'No exact duplicate files found',
    sourceArchive: 'Archive',
    sourceFolder: 'Folder',
    workspaceEmpty: 'Scan a library to build the content workspace',
    exportedSummary: 'Export complete',
    clearSelection: 'Clear selection',
    imageCount: 'images',
    archiveCount: 'archives',
    chooseDirectory: 'Choose folder',
    pathPlaceholder: 'Choose or enter a content folder',
    scan: 'Scan',
    stopScan: 'Stop scan',
    supportPrefix: 'Images',
    archivePrefix: 'Archives',
    notScanned: 'No folder scanned',
    viewerTitle: 'Content viewer',
    previous: 'Previous',
    next: 'Next',
    fit: 'Fit to window',
    actual: 'Actual size',
    rotate: 'Rotate',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit fullscreen',
    loadingImage: 'Loading content',
    pickImage: 'Choose an image or document on the left',
    noImage: 'No content selected',
    selectPathFirst: 'Choose or enter a folder first',
    operationFailed: 'Operation failed',
    cancelOperation: 'Cancel operation',
    previewTruncated: 'Large file: showing only the beginning',
    remoteContentBlocked: 'Remote content blocked',
    documentTheme: 'Document theme',
    previewView: 'Preview',
    rawView: 'Raw',
    invalidJson: 'Unable to parse JSON',
    filterRows: 'Filter table rows',
    noMatchingRows: 'No matching rows',
    rows: 'rows',
    columns: 'columns',
    structuredTruncated: 'Content is large; the displayed result is limited',
    searchContent: 'Search name, path, or format',
    allContent: 'All types',
    imagesOnly: 'Images only',
    documentsOnly: 'Documents only',
    allSources: 'All sources',
    foldersOnly: 'Folders',
    archivesOnly: 'Archives',
    selectFiltered: 'Select filtered',
    showingResults: 'Showing',
    loadMore: 'Show more',
    loadAll: 'Load all',
    loadingItems: 'Loading content',
    loadingItemsHint: 'Preparing items for display. Please wait.',
    calculateChecksum: 'Calculate SHA-256',
    copyChecksum: 'Copy SHA-256',
    scanning: 'Scanning',
    scannedDirectories: 'Scanned folders',
    pendingDirectories: 'Pending',
    expand: 'Expand',
    collapse: 'Collapse',
    contextMenu: 'Context menu',
    selectItem: 'Select',
    copyName: 'Copy name',
    copyPath: 'Copy path',
    pinnedDirectories: 'Pinned folders',
    currentDirectory: 'Current folder',
    noPinnedDirectories: 'No pinned folders',
    pinDirectory: 'Pin folder',
    unpinDirectory: 'Unpin folder',
    copyToClipboard: 'Copy to clipboard',
    copyImageLocation: 'Copy image location',
    language: 'Language',
    settings: 'Settings',
    display: 'Display',
    formats: 'File Formats',
    imageFormats: 'Images',
    documentFormats: 'Documents',
    clearAll: 'Clear all',
    about: 'About',
    zoomBehavior: 'Zoom',
    zoomFitArea: 'Fit display area',
    zoomShrinkLarge: 'Scale down only',
    zoomLockRatio: 'Lock ratio',
    automatic: 'Automatic',
    stageBackground: 'Background',
    backgroundLightGray: 'Light Gray',
    backgroundWhite: 'White',
    backgroundDarkGray: 'Dark Gray',
    backgroundBlack: 'Black',
    backgroundChecker: 'Checker',
    close: 'Close',
    supportedFormats: 'Supported formats',
    selectAll: 'Select all',
    hardwareInfo: 'Hardware',
    osVersion: 'OS Version',
    appVersion: 'App Version',
    buildInfo: 'Build Source',
    sourceCode: 'Source Code',
    license: 'License',
    copySourceUrl: 'Copy GitHub URL',
    noWarranty: 'This program is provided under GPLv3 without warranty. Complete license and third-party notices are included in the App Bundle under Resources/Licenses.',
    unavailable: 'Unavailable',
  },
  ja: {
    appName: 'ファイルデスク',
    documentCount: '件の文書',
    contentCount: '項目',
    loadingDocument: '文書を読み込み中',
    markdownPreview: 'Markdown プレビュー',
    textPreview: 'テキストプレビュー',
    codePreview: 'コードプレビュー',
    workspace: 'コンテンツワークスペース',
    workspaceSubtitle: 'フォルダと圧縮ファイル内の画像・文書・コードを閲覧',
    selectedCount: '選択済み',
    exportSelected: '選択項目を書き出す',
    exportDestination: '書き出し先を選択',
    detectDuplicates: '完全重複ファイルを検出',
    duplicateGroups: '重複グループ',
    noDuplicates: '完全に同一のファイルは見つかりませんでした',
    sourceArchive: '圧縮ファイル',
    sourceFolder: 'フォルダ',
    workspaceEmpty: 'スキャン後にコンテンツワークスペースを利用できます',
    exportedSummary: '書き出し完了',
    clearSelection: '選択を解除',
    imageCount: '枚の画像',
    archiveCount: '個の圧縮ファイル',
    chooseDirectory: 'フォルダを選択',
    pathPlaceholder: 'コンテンツフォルダを選択または入力',
    scan: 'スキャン',
    stopScan: 'スキャン停止',
    supportPrefix: '画像',
    archivePrefix: '圧縮ファイル',
    notScanned: '未スキャン',
    viewerTitle: 'コンテンツビューア',
    previous: '前へ',
    next: '次へ',
    fit: 'ウィンドウに合わせる',
    actual: '実寸',
    rotate: '回転',
    zoomIn: '拡大',
    zoomOut: '縮小',
    fullscreen: '全画面',
    exitFullscreen: '全画面を終了',
    loadingImage: 'コンテンツを読み込み中',
    pickImage: '左側で画像または文書を選択してください',
    noImage: 'コンテンツ未選択',
    selectPathFirst: '先にフォルダを選択または入力してください',
    operationFailed: '操作に失敗しました',
    cancelOperation: '処理をキャンセル',
    previewTruncated: '大きなファイルの先頭部分のみ表示しています',
    remoteContentBlocked: 'リモートコンテンツをブロックしました',
    documentTheme: '文書テーマ',
    previewView: 'プレビュー',
    rawView: 'ソース',
    invalidJson: 'JSON を解析できません',
    filterRows: '表の内容を検索',
    noMatchingRows: '一致する行がありません',
    rows: '行',
    columns: '列',
    structuredTruncated: '内容が多いため表示件数を制限しています',
    searchContent: '名前、パス、形式を検索',
    allContent: 'すべての種類',
    imagesOnly: '画像のみ',
    documentsOnly: '文書のみ',
    allSources: 'すべてのソース',
    foldersOnly: 'フォルダ',
    archivesOnly: '圧縮ファイル',
    selectFiltered: '絞り込み結果を選択',
    showingResults: '表示件数',
    loadMore: 'さらに表示',
    loadAll: 'すべて読み込む',
    loadingItems: 'コンテンツを読み込み中',
    loadingItemsHint: '表示項目を準備しています。しばらくお待ちください。',
    calculateChecksum: 'SHA-256 を計算',
    copyChecksum: 'SHA-256 をコピー',
    scanning: 'スキャン中',
    scannedDirectories: 'スキャン済みフォルダ',
    pendingDirectories: '待機中',
    expand: '展開',
    collapse: '折りたたみ',
    contextMenu: '操作メニュー',
    selectItem: '選択',
    copyName: '名前をコピー',
    copyPath: 'パスをコピー',
    pinnedDirectories: 'ピン留めフォルダ',
    currentDirectory: '現在のフォルダ',
    noPinnedDirectories: 'ピン留めフォルダはありません',
    pinDirectory: 'フォルダをピン留め',
    unpinDirectory: 'ピン留めを解除',
    copyToClipboard: 'クリップボードにコピー',
    copyImageLocation: '画像の場所をコピー',
    language: '言語',
    settings: '設定',
    display: '表示',
    formats: 'ファイル形式',
    imageFormats: '画像ファイル',
    documentFormats: '文書ファイル',
    clearAll: 'すべて解除',
    about: '情報',
    zoomBehavior: 'ズーム',
    zoomFitArea: '表示領域に合わせる',
    zoomShrinkLarge: '大きい場合のみ縮小',
    zoomLockRatio: '倍率を固定',
    automatic: '自動',
    stageBackground: '背景色',
    backgroundLightGray: 'ライトグレー',
    backgroundWhite: '白',
    backgroundDarkGray: 'ダークグレー',
    backgroundBlack: '黒',
    backgroundChecker: 'チェック柄',
    close: '閉じる',
    supportedFormats: '対応形式',
    selectAll: 'すべて選択',
    hardwareInfo: 'ハードウェア',
    osVersion: 'OS バージョン',
    appVersion: 'APP バージョン',
    buildInfo: 'ビルド情報',
    sourceCode: 'ソースコード',
    license: 'ライセンス',
    copySourceUrl: 'GitHub URL をコピー',
    noWarranty: '本プログラムは GPLv3 に基づき、無保証で提供されます。完全なライセンスと第三者通知は App Bundle の Resources/Licenses に含まれます。',
    unavailable: '取得できません',
  },
} satisfies Record<LocaleCode, Record<string, string>>;

const localeLabels: Record<LanguagePreference, string> = {
  auto: 'Auto',
  'zh-TW': '繁中',
  en: 'EN',
  ja: '日本語',
};

const stageBackgroundLabels: Record<StageBackground, keyof (typeof messages)['zh-TW']> = {
  lightGray: 'backgroundLightGray',
  white: 'backgroundWhite',
  darkGray: 'backgroundDarkGray',
  black: 'backgroundBlack',
  checker: 'backgroundChecker',
};

const zoomBehaviorLabels: Record<ZoomBehavior, keyof (typeof messages)['zh-TW']> = {
  fitArea: 'zoomFitArea',
  shrinkLarge: 'zoomShrinkLarge',
  lockRatio: 'zoomLockRatio',
};

const documentThemeOptions: Array<{ value: DocumentTheme; label: string }> = [
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'github-light', label: 'GitHub Light' },
  { value: 'atom-one-dark', label: 'Atom One Dark' },
  { value: 'nord', label: 'Nord' },
  { value: 'monokai', label: 'Monokai' },
];

const documentThemeUrls: Record<DocumentTheme, string> = {
  'github-dark': githubDarkThemeUrl,
  'github-light': githubLightThemeUrl,
  'atom-one-dark': atomOneDarkThemeUrl,
  nord: nordThemeUrl,
  monokai: monokaiThemeUrl,
};

const workspacePageSize = 120;
const libraryWidthLimits = { min: 480, default: 500, max: 720 };
const maxImagePayloadCacheEntries = 5;
const maxImagePayloadCacheBytes = 192 * 1024 * 1024;
const imagePayloadCache = new Map<string, ImagePayload>();
const imagePayloadPrefetches = new Map<string, Promise<ImagePayload | null>>();
let imagePayloadCacheBytes = 0;
let imagePayloadCacheGeneration = 0;

const storageKeys = {
  locale: 'fastfileviewer.locale',
  stageBackground: 'fastfileviewer.stageBackground',
  zoomBehavior: 'fastfileviewer.zoomBehavior',
  documentTheme: 'fastfileviewer.documentTheme',
  enabledImageExtensions: 'fastfileviewer.enabledImageExtensions',
  enabledDocumentExtensions: 'fastfileviewer.enabledDocumentExtensions.v2',
  rootPath: 'fastfileviewer.rootPath',
  libraryCache: 'fastfileviewer.libraryCache.v3',
  librarySelection: 'fastfileviewer.librarySelection.v1',
  libraryWidth: 'fastfileviewer.libraryWidth',
  libraryCollapsed: 'fastfileviewer.libraryCollapsed',
  pinnedDirectories: 'fastfileviewer.pinnedDirectories.v1',
  librarySourceTab: 'fastfileviewer.librarySourceTab',
};

interface PersistedLibraryCache {
  rootPath: string;
  tree: LibraryNode;
  selectedNodeId: string;
  selectedImageId: string;
  expandedNodeIds: string[];
  scannedDirectories: number;
  savedAt: number;
}

interface PersistedLibrarySelection {
  rootPath: string;
  selectedNodeId: string;
  selectedImageId: string;
}

interface ContextMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload>(fallbackBootstrap);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [documentFormatsReady, setDocumentFormatsReady] = useState(false);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(() => resolveInitialLanguagePreference());
  const [stageBackground, setStageBackground] = useState<StageBackground>(() => resolveInitialStageBackground());
  const [zoomBehavior, setZoomBehavior] = useState<ZoomBehavior>(() => resolveInitialZoomBehavior());
  const [documentTheme, setDocumentTheme] = useState<DocumentTheme>(() => resolveInitialDocumentTheme());
  const [enabledImageExtensions, setEnabledImageExtensions] = useState<string[]>(() => resolveInitialEnabledImageExtensions());
  const [enabledDocumentExtensions, setEnabledDocumentExtensions] = useState<string[]>(() => resolveInitialEnabledDocumentExtensions());
  const locale = useMemo(() => resolveLocale(languagePreference), [languagePreference]);
  const [rootPath, setRootPath] = useState('');
  const [tree, setTree] = useState<LibraryNode | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [selectedImageId, setSelectedImageId] = useState('');
  const [imagePayload, setImagePayload] = useState<ImagePayload | null>(null);
  const [documentPayload, setDocumentPayload] = useState<DocumentPayload | null>(null);
  const [documentViewMode, setDocumentViewMode] = useState<'preview' | 'raw'>('preview');
  const [viewerMode, setViewerMode] = useState<ViewerMode>('fit');
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [scannedDirectories, setScannedDirectories] = useState(0);
  const [pendingDirectories, setPendingDirectories] = useState(0);
  const [currentScanPath, setCurrentScanPath] = useState('');
  const [panning, setPanning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [libraryWidth, setLibraryWidth] = useState(() => {
    const storedWidth = Number(localStorage.getItem(storageKeys.libraryWidth));
    return Number.isFinite(storedWidth) && storedWidth >= libraryWidthLimits.min && storedWidth <= libraryWidthLimits.max
      ? storedWidth
      : libraryWidthLimits.default;
  });
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => localStorage.getItem(storageKeys.libraryCollapsed) === 'true');
  const [pinnedDirectories, setPinnedDirectories] = useState<string[]>(readPinnedDirectories);
  const [librarySourceTab, setLibrarySourceTab] = useState<'current' | 'pinned'>(() => localStorage.getItem(storageKeys.librarySourceTab) === 'pinned' ? 'pinned' : 'current');
  const [selectedWorkspaceImageIds, setSelectedWorkspaceImageIds] = useState<Set<string>>(new Set());
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState('');
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [workspaceKindFilter, setWorkspaceKindFilter] = useState<WorkspaceKindFilter>('all');
  const [workspaceSourceFilter, setWorkspaceSourceFilter] = useState<WorkspaceSourceFilter>('all');
  const [workspaceDisplayLimit, setWorkspaceDisplayLimit] = useState(workspacePageSize);
  const [workspaceLoadTarget, setWorkspaceLoadTarget] = useState<number | null>(null);
  const [activeChecksum, setActiveChecksum] = useState('');
  const [checksumBusy, setChecksumBusy] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('display');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo>(fallbackAppInfo);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const scanTokenRef = useRef(0);
  const scanOperationRef = useRef<number | null>(null);
  const workspaceOperationRef = useRef<number | null>(null);
  const checksumOperationRef = useRef<number | null>(null);
  const imageLoadOperationRef = useRef<number | null>(null);
  const imagePrefetchOperationRef = useRef<number | null>(null);
  const cacheSaveTimerRef = useRef<number | null>(null);
  const imageStageRef = useRef<HTMLElement | null>(null);
  const dragPanRef = useRef({
    active: false,
    pointerId: 0,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  const t = messages[locale];
  const pinnedDirectorySet = useMemo(() => new Set(pinnedDirectories), [pinnedDirectories]);

  useEffect(() => {
    WindowSetTitle(t.appName);
  }, [t.appName]);

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  useEffect(() => {
    localStorage.setItem(storageKeys.locale, languagePreference);
  }, [languagePreference]);

  useEffect(() => {
    localStorage.setItem(storageKeys.stageBackground, stageBackground);
  }, [stageBackground]);

  useEffect(() => {
    localStorage.setItem(storageKeys.zoomBehavior, zoomBehavior);
  }, [zoomBehavior]);

  useEffect(() => {
    localStorage.setItem(storageKeys.documentTheme, documentTheme);
    const elementId = 'fastfileviewer-highlight-theme';
    let themeLink = document.getElementById(elementId) as HTMLLinkElement | null;
    if (!themeLink) {
      themeLink = document.createElement('link');
      themeLink.id = elementId;
      themeLink.rel = 'stylesheet';
      document.head.appendChild(themeLink);
    }
    themeLink.href = documentThemeUrls[documentTheme];
  }, [documentTheme]);

  useEffect(() => {
    localStorage.setItem(storageKeys.libraryWidth, String(libraryWidth));
  }, [libraryWidth]);

  useEffect(() => {
    localStorage.setItem(storageKeys.libraryCollapsed, String(libraryCollapsed));
  }, [libraryCollapsed]);

  useEffect(() => {
    localStorage.setItem(storageKeys.pinnedDirectories, JSON.stringify(pinnedDirectories));
  }, [pinnedDirectories]);

  useEffect(() => {
    localStorage.setItem(storageKeys.librarySourceTab, librarySourceTab);
  }, [librarySourceTab]);

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }
    localStorage.setItem(storageKeys.enabledImageExtensions, JSON.stringify(enabledImageExtensions));
  }, [bootstrapReady, enabledImageExtensions]);

  useEffect(() => {
    if (!documentFormatsReady) {
      return;
    }
    localStorage.setItem(storageKeys.enabledDocumentExtensions, JSON.stringify(enabledDocumentExtensions));
  }, [documentFormatsReady, enabledDocumentExtensions]);

  useEffect(() => {
    if (!bootstrapReady) {
      return;
    }
    setEnabledImageExtensions((current) => {
      return normalizeEnabledExtensions(current, bootstrap.supportedImages);
    });
  }, [bootstrap.supportedImages, bootstrapReady]);

  useEffect(() => {
    void window.go?.app?.App?.Bootstrap?.()
      .then(async (payload) => {
        const storedDocuments = readStoredEnabledExtensions(storageKeys.enabledDocumentExtensions, payload.supportedDocuments);
        setBootstrap(payload);
        setEnabledDocumentExtensions(storedDocuments ?? [...payload.supportedDocuments]);
        setBootstrapReady(true);
        setDocumentFormatsReady(true);
        const persistedRootPath = readPersistedRootPath();
        const initialRootPath = persistedRootPath || payload.defaultPath;
        setRootPath(initialRootPath);
        if (persistedRootPath) {
          const cache = await readLibraryCache(persistedRootPath);
          if (cache) {
            applyLibraryCache(cache);
          }
        }
      })
      .catch(() => undefined);

    void window.go?.app?.App?.GetAppInfo?.()
      .then((payload) => {
        if (payload) {
          setAppInfo(payload);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (rootPath.trim()) {
      localStorage.setItem(storageKeys.rootPath, rootPath.trim());
    }
  }, [rootPath]);

  useEffect(() => {
    void WindowIsFullscreen()
      .then(setFullscreen)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    window.addEventListener('click', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('scroll', closeContextMenu, true);
    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
      window.removeEventListener('scroll', closeContextMenu, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const stage = imageStageRef.current;
    if (!stage) {
      return;
    }

    const updateStageSize = () => {
      setStageSize({
        width: stage.clientWidth,
        height: stage.clientHeight,
      });
    };
    updateStageSize();

    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(stage);
    window.addEventListener('resize', updateStageSize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateStageSize);
    };
  }, [fullscreen, imagePayload]);

  const displayTree = useMemo(() => buildVisibleTree(tree), [tree]);
  const navigationImages = useMemo(() => (displayTree ? collectImageRefs(displayTree) : []), [displayTree]);
  const allLibraryImages = useMemo(() => (displayTree ? collectImages(displayTree) : []), [displayTree]);
  const filteredWorkspaceImages = useMemo(
    () => filterWorkspaceEntries(allLibraryImages, workspaceQuery, workspaceKindFilter, workspaceSourceFilter),
    [allLibraryImages, workspaceKindFilter, workspaceQuery, workspaceSourceFilter],
  );
  const displayedWorkspaceImages = useMemo(
    () => filteredWorkspaceImages.slice(0, workspaceDisplayLimit),
    [filteredWorkspaceImages, workspaceDisplayLimit],
  );
  const selectedWorkspaceImages = useMemo(
    () => allLibraryImages.filter((image) => selectedWorkspaceImageIds.has(image.id)),
    [allLibraryImages, selectedWorkspaceImageIds],
  );

  useEffect(() => {
    const validIds = new Set(allLibraryImages.map((image) => image.id));
    setSelectedWorkspaceImageIds((current) => new Set(Array.from(current).filter((id) => validIds.has(id))));
  }, [allLibraryImages]);

  useEffect(() => {
    setDuplicateGroups([]);
    setWorkspaceDisplayLimit(workspacePageSize);
    setWorkspaceLoadTarget(null);
  }, [workspaceKindFilter, workspaceQuery, workspaceSourceFilter]);

  useEffect(() => {
    if (workspaceLoadTarget === null) {
      return;
    }
    if (workspaceDisplayLimit >= workspaceLoadTarget) {
      const timer = window.setTimeout(() => setWorkspaceLoadTarget(null), 320);
      return () => window.clearTimeout(timer);
    }
    const frame = window.requestAnimationFrame(() => {
      setWorkspaceDisplayLimit((current) => Math.min(workspaceLoadTarget, current + workspacePageSize));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [workspaceDisplayLimit, workspaceLoadTarget]);

  const selectedNode = useMemo(() => {
    if (!displayTree || !selectedNodeId) {
      return displayTree;
    }
    return findNode(displayTree, selectedNodeId) ?? displayTree;
  }, [displayTree, selectedNodeId]);

  const visibleImages = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    return collectImages(selectedNode);
  }, [selectedNode]);

  const selectedImageIndex = useMemo(
    () => visibleImages.findIndex((image) => image.id === selectedImageId),
    [selectedImageId, visibleImages],
  );
  const selectedImageEntry = useMemo(
    () => visibleImages.find((image) => image.id === selectedImageId) ?? null,
    [selectedImageId, visibleImages],
  );

  useEffect(() => {
    if (visibleImages.length === 0) {
      setSelectedImageId('');
      setImagePayload(null);
      setDocumentPayload(null);
      return;
    }
    if (!visibleImages.some((image) => image.id === selectedImageId)) {
      setSelectedImageId(visibleImages[0].id);
    }
  }, [selectedImageId, visibleImages]);

  useEffect(() => {
    setDocumentViewMode(selectedImageEntry && supportsDocumentPreview(selectedImageEntry.format) ? 'preview' : 'raw');
    setActiveChecksum('');
    setChecksumBusy(false);
    if (checksumOperationRef.current !== null) {
      void window.go?.app?.App?.CancelOperation?.(checksumOperationRef.current);
      checksumOperationRef.current = null;
    }
  }, [selectedImageEntry?.format, selectedImageEntry?.id]);

  useEffect(() => {
    if (imageLoadOperationRef.current !== null) {
      void window.go?.app?.App?.CancelOperation?.(imageLoadOperationRef.current);
      imageLoadOperationRef.current = null;
    }
    let cancelled = false;
    if (!selectedImageId) {
      return () => {
        cancelled = true;
      };
    }
    setLoadingImage(true);
    setErrorMessage('');
    setRotation(0);
    if (zoomBehavior !== 'lockRatio') {
      setZoom(1);
    }
    setImageNaturalSize({ width: 0, height: 0 });

    if (selectedImageEntry && selectedImageEntry.kind !== 'image') {
      setImagePayload(null);
      void window.go?.app?.App?.LoadDocumentByPath?.(selectedImageEntry.path)
        .then((payload) => {
          if (!cancelled && payload) {
            setDocumentPayload(payload);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setDocumentPayload(null);
            setErrorMessage(extractErrorMessage(error, t.operationFailed));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingImage(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    setDocumentPayload(null);

    const cachedPayload = selectedImageEntry ? getCachedImagePayload(selectedImageEntry) : null;
    if (cachedPayload) {
      setImagePayload(cachedPayload);
      setLoadingImage(false);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      let operationId = 0;
      try {
        if (selectedImageEntry) {
          const pendingPrefetch = imagePayloadPrefetches.get(imagePayloadCacheKey(selectedImageEntry));
          if (pendingPrefetch) {
            const prefetchedPayload = await pendingPrefetch;
            if (prefetchedPayload && !cancelled) {
              setImagePayload(prefetchedPayload);
              return;
            }
            if (cancelled) {
              return;
            }
          }
        }
        operationId = await window.go?.app?.App?.BeginOperation?.() ?? 0;
        if (cancelled) {
          if (operationId !== 0) {
            await window.go?.app?.App?.CancelOperation?.(operationId);
          }
          return;
        }
        imageLoadOperationRef.current = operationId || null;
        const payload = selectedImageEntry
          ? await loadImagePayloadByPath(selectedImageEntry.path, operationId)
          : await window.go?.app?.App?.LoadImage?.(selectedImageId);
        if (!payload || cancelled) {
          return;
        }
        await decodeImagePayload(payload);
        if (cancelled) {
          return;
        }
        if (selectedImageEntry) {
          cacheImagePayload(selectedImageEntry, payload);
        }
        setImagePayload(payload);
      } catch (error) {
        if (!cancelled && !isOperationCancelled(error)) {
          setImagePayload(null);
          setErrorMessage(extractErrorMessage(error, t.operationFailed));
        }
      } finally {
        if (operationId !== 0) {
          void window.go?.app?.App?.FinishOperation?.(operationId);
        }
        if (imageLoadOperationRef.current === operationId) {
          imageLoadOperationRef.current = null;
        }
        if (!cancelled) {
          setLoadingImage(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (imageLoadOperationRef.current !== null) {
        void window.go?.app?.App?.CancelOperation?.(imageLoadOperationRef.current);
      }
    };
  }, [selectedImageEntry, selectedImageId, t.operationFailed, zoomBehavior]);

  useEffect(() => {
    if (!selectedImageEntry || selectedImageEntry.kind !== 'image' || imagePayload?.id !== selectedImageEntry.id) {
      return;
    }
    const imageNavigationEntries = navigationImages
      .map((item) => item.image)
      .filter((image) => image.kind === 'image');
    const currentIndex = imageNavigationEntries.findIndex((image) => image.id === selectedImageEntry.id);
    if (currentIndex < 0) {
      return;
    }
    let cancelled = false;
    const candidates: ImageEntry[] = [];
    const candidateKeys = new Set<string>();
    for (const offset of [1, -1, 2, -2]) {
      const index = (currentIndex + offset + imageNavigationEntries.length) % imageNavigationEntries.length;
      const candidate = imageNavigationEntries[index];
      if (!candidate) {
        continue;
      }
      const key = imagePayloadCacheKey(candidate);
      if (key !== imagePayloadCacheKey(selectedImageEntry) && !candidateKeys.has(key)) {
        candidateKeys.add(key);
        candidates.push(candidate);
      }
    }
    void (async () => {
      for (const candidate of candidates) {
        if (cancelled) {
          return;
        }
        if (getCachedImagePayload(candidate)) {
          continue;
        }
        const operationId = await window.go?.app?.App?.BeginOperation?.() ?? 0;
        if (cancelled) {
          if (operationId !== 0) {
            await window.go?.app?.App?.CancelOperation?.(operationId);
            await window.go?.app?.App?.FinishOperation?.(operationId);
          }
          return;
        }
        imagePrefetchOperationRef.current = operationId || null;
        await prefetchImagePayload(candidate, operationId);
        if (operationId !== 0) {
          void window.go?.app?.App?.FinishOperation?.(operationId);
        }
        if (imagePrefetchOperationRef.current === operationId) {
          imagePrefetchOperationRef.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
      if (imagePrefetchOperationRef.current !== null) {
        void window.go?.app?.App?.CancelOperation?.(imagePrefetchOperationRef.current);
      }
    };
  }, [imagePayload?.id, navigationImages, selectedImageEntry]);

  useEffect(() => {
    if (!tree || !rootPath.trim() || scanning) {
      return;
    }

    if (cacheSaveTimerRef.current !== null) {
      window.clearTimeout(cacheSaveTimerRef.current);
    }
    cacheSaveTimerRef.current = window.setTimeout(() => {
      void writeLibraryCache({
        rootPath: rootPath.trim(),
        tree,
        selectedNodeId,
        selectedImageId,
        expandedNodeIds: Array.from(expandedNodeIds),
        scannedDirectories,
        savedAt: Date.now(),
      });
      cacheSaveTimerRef.current = null;
    }, 250);

    return () => {
      if (cacheSaveTimerRef.current !== null) {
        window.clearTimeout(cacheSaveTimerRef.current);
        cacheSaveTimerRef.current = null;
      }
    };
  }, [expandedNodeIds, rootPath, scannedDirectories, scanning, tree]);

  useEffect(() => {
    if (!tree || !rootPath.trim()) {
      return;
    }
    writeLibrarySelection({
      rootPath: rootPath.trim(),
      selectedNodeId,
      selectedImageId,
    });
  }, [rootPath, selectedImageId, selectedNodeId, tree]);

  const applyLibraryCache = (cache: PersistedLibraryCache) => {
    const selection = readLibrarySelection(cache.rootPath);
    const cachedNodeId = selection?.selectedNodeId || cache.selectedNodeId;
    const cachedImageId = selection?.selectedImageId || cache.selectedImageId;
    setTree(cache.tree);
    setSelectedNodeId(findNode(cache.tree, cachedNodeId)?.id ?? cache.tree.id);
    setSelectedImageId(findImage(cache.tree, cachedImageId)?.id ?? collectImages(cache.tree)[0]?.id ?? '');
    setExpandedNodeIds(new Set(cache.expandedNodeIds.length > 0 ? cache.expandedNodeIds : [cache.tree.id]));
    setScannedDirectories(cache.scannedDirectories);
  };

  const handleChooseDirectory = async () => {
    const selectedPath = await window.go?.app?.App?.SelectDirectory?.(t.chooseDirectory);
    if (selectedPath) {
      setRootPath(selectedPath);
      await handleScan(selectedPath);
    }
  };

  const togglePinnedDirectory = (directoryPath: string) => {
    const normalizedPath = normalizePinnedDirectory(directoryPath);
    if (!normalizedPath) {
      return;
    }
    setPinnedDirectories((current) => current.includes(normalizedPath)
      ? current.filter((path) => path !== normalizedPath)
      : [...current, normalizedPath]);
  };

  const openPinnedDirectory = (directoryPath: string) => {
    if (scanning) {
      return;
    }
    setLibrarySourceTab('current');
    setRootPath(directoryPath);
    void handleScan(directoryPath);
  };

  const handleStopScan = () => {
    scanTokenRef.current += 1;
    if (scanOperationRef.current !== null) {
      void window.go?.app?.App?.CancelOperation?.(scanOperationRef.current);
    }
    setScanning(false);
    setCurrentScanPath('');
    setPendingDirectories(0);
  };

  const handleScan = async (targetPath = rootPath) => {
    const trimmedPath = targetPath.trim();
    if (!trimmedPath) {
      setErrorMessage(t.selectPathFirst);
      return;
    }

    const token = scanTokenRef.current + 1;
    clearImagePayloadCache();
    scanTokenRef.current = token;
    setScanning(true);
    setErrorMessage('');
    setImagePayload(null);
    setScannedDirectories(0);
    setPendingDirectories(1);
    setCurrentScanPath(trimmedPath);
    setRootPath(trimmedPath);

    const cache = await readLibraryCache(trimmedPath);
    if (cache) {
      applyLibraryCache(cache);
    } else {
      setSelectedImageId('');
      setTree(null);
      setSelectedNodeId('');
      setExpandedNodeIds(new Set());
    }

    let operationId = 0;
    try {
      operationId = await window.go?.app?.App?.BeginOperation?.() ?? 0;
      scanOperationRef.current = operationId;
      await window.go?.app?.App?.ResetLibrary?.();
      const firstResult = await window.go?.app?.App?.ScanDirectory?.(trimmedPath, enabledImageExtensions, enabledDocumentExtensions, operationId);
      if (!firstResult?.node || scanTokenRef.current !== token) {
        return;
      }

      const rootNode = firstResult.node;
      setTree((current) => (current ? mergeScannedNode(current, rootNode) : rootNode));
      setSelectedNodeId((current) => current || rootNode.id);
      setExpandedNodeIds((current) => new Set(current.size > 0 ? current : [rootNode.id]));
      setRootPath(firstResult.rootPath);
      setScannedDirectories(1);
      if (firstResult.warnings?.length) {
        setErrorMessage(firstResult.warnings.join('\n'));
      }

      const queue = rootNode.children.filter((child) => child.kind === 'directory').map((child) => child.path);
      setPendingDirectories(queue.length);

      while (queue.length > 0) {
        if (scanTokenRef.current !== token) {
          return;
        }

        const nextPath = queue.shift() ?? '';
        setCurrentScanPath(nextPath);
        setPendingDirectories(queue.length + 1);

        try {
          const result = await window.go?.app?.App?.ScanDirectory?.(nextPath, enabledImageExtensions, enabledDocumentExtensions, operationId);
          if (!result?.node || scanTokenRef.current !== token) {
            return;
          }
          const scannedNode = result.node;
          setTree((current) => (current ? mergeScannedNode(current, scannedNode) : current));
          setScannedDirectories((current) => current + 1);
          if (result.warnings?.length) {
            setErrorMessage(result.warnings.join('\n'));
          }
          const childDirectories = scannedNode.children.filter((child) => child.kind === 'directory').map((child) => child.path);
          queue.push(...childDirectories);
          setPendingDirectories(queue.length);
          await yieldToUI();
        } catch (error) {
          if (!isOperationCancelled(error)) {
            setErrorMessage(extractErrorMessage(error, t.operationFailed));
          }
        }
      }
    } catch (error) {
      if (!isOperationCancelled(error)) {
        setTree(null);
        setSelectedNodeId('');
        setErrorMessage(extractErrorMessage(error, t.operationFailed));
      }
    } finally {
      if (operationId !== 0) {
        void window.go?.app?.App?.FinishOperation?.(operationId);
      }
      if (scanOperationRef.current === operationId) {
        scanOperationRef.current = null;
      }
      if (scanTokenRef.current === token) {
        setScanning(false);
        setPendingDirectories(0);
        setCurrentScanPath('');
      }
    }
  };

  const moveSelection = (offset: number) => {
    if (navigationImages.length === 0) {
      return;
    }
    const currentIndex = navigationImages.findIndex((item) => item.image.id === selectedImageId);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (baseIndex + offset + navigationImages.length) % navigationImages.length;
    const nextItem = navigationImages[nextIndex];
    setSelectedNodeId(nextItem.node.id);
    setSelectedImageId(nextItem.image.id);
  };

  const copyText = (value: string) => {
    if (!value) {
      return;
    }
    void ClipboardSetText(value)
      .catch(() => navigator.clipboard?.writeText(value).catch(() => undefined));
  };

  const copyImageToClipboard = (image: ImageEntry | null) => {
    if (!image) {
      return;
    }
    void loadImagePayloadForClipboard(image)
      .then((payload) => writeImagePayloadToClipboard(payload))
      .catch((error) => setErrorMessage(extractErrorMessage(error, t.operationFailed)));
  };

  const loadImagePayloadForClipboard = async (image: ImageEntry): Promise<ImagePayload> => {
    if (imagePayload?.id === image.id) {
      return imagePayload;
    }
    const cachedPayload = getCachedImagePayload(image);
    if (cachedPayload) {
      return cachedPayload;
    }
    const payload = await loadImagePayloadByPath(image.path, 0);
    if (!payload) {
      throw new Error(t.operationFailed);
    }
    return payload;
  };

  const openContextMenu = (event: MouseEvent<HTMLElement>, items: ContextMenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    const position = clampContextMenuPosition(event.clientX, event.clientY);
    setContextMenu({
      ...position,
      items,
    });
  };

  const openNodeContextMenu = (event: MouseEvent<HTMLElement>, node: LibraryNode) => {
    const expanded = expandedNodeIds.has(node.id);
    const hasExpandableItems = node.children.length > 0 || node.images.length > 0;
    const items: ContextMenuItem[] = [
      {
        label: t.selectItem,
        action: () => selectTreeNode(node),
      },
    ];

    if (hasExpandableItems) {
      items.push({
        label: expanded ? t.collapse : t.expand,
        action: () => toggleExpanded(node.id),
      });
    }

    if (node.kind === 'directory') {
      const pinned = pinnedDirectorySet.has(normalizePinnedDirectory(node.path));
      items.push({
        label: pinned ? t.unpinDirectory : t.pinDirectory,
        action: () => togglePinnedDirectory(node.path),
      });
    }

    items.push(
      {
        label: t.copyName,
        action: () => copyText(node.name),
      },
      {
        label: t.copyPath,
        action: () => copyText(node.path),
      },
    );
    openContextMenu(event, items);
  };

  const openImageContextMenu = (event: MouseEvent<HTMLElement>, node: LibraryNode, image: ImageEntry) => {
    openContextMenu(event, [
      {
        label: t.selectItem,
        action: () => {
          setSelectedNodeId(node.id);
          setSelectedImageId(image.id);
        },
      },
      {
        label: t.copyName,
        action: () => copyText(image.name),
      },
      {
        label: t.copyToClipboard,
        action: () => copyImageToClipboard(image),
      },
      {
        label: t.copyImageLocation,
        action: () => copyText(image.path),
      },
    ]);
  };

  const openViewerContextMenu = (event: MouseEvent<HTMLElement>) => {
    openContextMenu(event, [
      {
        label: t.previous,
        action: () => moveSelection(-1),
        disabled: navigationImages.length === 0,
      },
      {
        label: t.next,
        action: () => moveSelection(1),
        disabled: navigationImages.length === 0,
      },
      {
        label: t.fit,
        action: () => setViewerMode('fit'),
        disabled: !imagePayload,
      },
      {
        label: t.actual,
        action: () => setViewerMode('actual'),
        disabled: !imagePayload,
      },
      {
        label: t.copyName,
        action: () => copyText(activeImage?.name ?? ''),
        disabled: !activeImage,
      },
      {
        label: t.copyToClipboard,
        action: () => copyImageToClipboard(activeImage),
        disabled: !activeImage,
      },
      {
        label: t.copyImageLocation,
        action: () => copyText(activeImage?.path ?? ''),
        disabled: !activeImage,
      },
    ]);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && contextMenu) {
        event.preventDefault();
        closeContextMenu();
        return;
      }
      if (event.key === 'Escape' && settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }
      if (event.key === 'Escape' && workspaceOpen) {
        event.preventDefault();
        setWorkspaceOpen(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveSelection(-1);
      }
      if (event.key === 'ArrowRight' || event.code === 'Space') {
        event.preventDefault();
        moveSelection(1);
      }
      if (event.key === 'Escape' && fullscreen) {
        event.preventDefault();
        void exitViewFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu, fullscreen, navigationImages, selectedImageId, settingsOpen, visibleImages, workspaceOpen]);

  const handleWheelNavigation = (event: React.WheelEvent<HTMLElement>) => {
    if (!activeIsImage || visibleImages.length === 0) {
      return;
    }
    const axisDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (axisDelta === 0) {
      return;
    }

    event.preventDefault();
    moveSelection(axisDelta > 0 ? 1 : -1);
  };

  const handleLibraryResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (libraryCollapsed) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = libraryWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      setLibraryWidth(Math.min(libraryWidthLimits.max, Math.max(libraryWidthLimits.min, startWidth + moveEvent.clientX - startX)));
    };
    const handlePointerUp = () => {
      document.body.classList.remove('resizing-library');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    document.body.classList.add('resizing-library');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const changeZoom = (delta: number) => {
    if (viewerMode === 'fit') {
      const fitZoom = calculateViewportScale(imageNaturalSize, stageSize, zoomBehavior) * zoom;
      setViewerMode('actual');
      setZoom(clampZoom(Math.round((fitZoom + delta) * 100) / 100));
      return;
    }
    setZoom((current) => clampZoom(Math.round((current + delta) * 100) / 100));
  };

  const centerActualImage = () => {
    window.requestAnimationFrame(() => {
      const stage = imageStageRef.current;
      if (!stage) {
        return;
      }
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
    });
  };

  useEffect(() => {
    centerActualImage();
  }, [fullscreen, imagePayload?.id, viewerMode, zoom, zoomBehavior]);

  const enterViewFullscreen = async () => {
    WindowFullscreen();
    setFullscreen(true);
  };

  const exitViewFullscreen = async () => {
    WindowUnfullscreen();
    setFullscreen(false);
  };

  const handleToggleFullscreen = async () => {
    if (fullscreen) {
      await exitViewFullscreen();
      return;
    }
    await enterViewFullscreen();
  };

  const toggleImageExtension = (extension: string) => {
    setEnabledImageExtensions((current) => {
      const normalized = normalizeExtension(extension);
      if (current.includes(normalized)) {
        return current.filter((item) => item !== normalized);
      }
      return normalizeEnabledExtensions([...current, normalized], bootstrap.supportedImages);
    });
  };

  const toggleDocumentExtension = (extension: string) => {
    setEnabledDocumentExtensions((current) => {
      const normalized = normalizeExtension(extension);
      if (current.includes(normalized)) {
        return current.filter((item) => item !== normalized);
      }
      return normalizeEnabledExtensions([...current, normalized], bootstrap.supportedDocuments);
    });
  };

  const handleZoomBehaviorChange = (nextZoomBehavior: ZoomBehavior) => {
    setZoomBehavior(nextZoomBehavior);
    if (nextZoomBehavior === 'lockRatio') {
      setViewerMode('actual');
      return;
    }
    setViewerMode('fit');
    setZoom(1);
  };

  const handleStageDoubleClick = () => {
    if (fullscreen) {
      void exitViewFullscreen();
      return;
    }
    void enterViewFullscreen();
  };

  const handlePanStart = (event: React.PointerEvent<HTMLElement>) => {
    if (!imagePayload || event.button !== 0) {
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

  const handlePanMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragPanRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) {
      return;
    }

    const stage = event.currentTarget;
    stage.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    stage.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
    event.preventDefault();
  };

  const handlePanEnd = (event: React.PointerEvent<HTMLElement>) => {
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

  const toggleExpanded = (nodeId: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const selectTreeNode = (node: LibraryNode) => {
    setSelectedNodeId(node.id);
    const firstImage = firstImageInTreeOrder(node);
    setSelectedImageId(firstImage?.id ?? '');
    if (!firstImage) {
      setImagePayload(null);
    }
  };

  const toggleWorkspaceImage = (imageId: string) => {
    setSelectedWorkspaceImageIds((current) => {
      const next = new Set(current);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  };

  const handleExportSelected = async () => {
    if (selectedWorkspaceImages.length === 0) {
      return;
    }
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      const operationId = await window.go?.app?.App?.BeginOperation?.() ?? 0;
      workspaceOperationRef.current = operationId;
      const result = await window.go?.app?.App?.ExportImages?.(selectedWorkspaceImages, t.exportDestination, operationId);
      if (result) {
        setWorkspaceMessage(`${t.exportedSummary}: ${result.exported.toLocaleString()} · ${result.destination}`);
      }
    } catch (error) {
      if (!isOperationCancelled(error)) {
        setWorkspaceMessage(extractErrorMessage(error, t.operationFailed));
      }
    } finally {
      workspaceOperationRef.current = null;
      setWorkspaceBusy(false);
    }
  };

  const handleDetectDuplicates = async () => {
    if (filteredWorkspaceImages.length === 0) {
      return;
    }
    setWorkspaceBusy(true);
    setWorkspaceMessage('');
    try {
      const operationId = await window.go?.app?.App?.BeginOperation?.() ?? 0;
      workspaceOperationRef.current = operationId;
      const groups = await window.go?.app?.App?.DetectDuplicates?.(filteredWorkspaceImages, operationId);
      setDuplicateGroups(groups ?? []);
      if (!groups || groups.length === 0) {
        setWorkspaceMessage(t.noDuplicates);
      }
    } catch (error) {
      if (!isOperationCancelled(error)) {
        setWorkspaceMessage(extractErrorMessage(error, t.operationFailed));
      }
    } finally {
      workspaceOperationRef.current = null;
      setWorkspaceBusy(false);
    }
  };

  const handleCancelWorkspaceOperation = () => {
    if (workspaceOperationRef.current !== null) {
      void window.go?.app?.App?.CancelOperation?.(workspaceOperationRef.current);
    }
  };

  const handleCalculateChecksum = async () => {
    if (!activeImage || checksumBusy) {
      return;
    }
    setChecksumBusy(true);
    try {
      const operationId = await window.go?.app?.App?.BeginOperation?.() ?? 0;
      checksumOperationRef.current = operationId;
      const checksum = await window.go?.app?.App?.CalculateChecksum?.(activeImage, operationId);
      if (checksum) {
        setActiveChecksum(checksum);
      }
    } catch (error) {
      if (!isOperationCancelled(error)) {
        setErrorMessage(extractErrorMessage(error, t.operationFailed));
      }
    } finally {
      checksumOperationRef.current = null;
      setChecksumBusy(false);
    }
  };

  const activeImage = selectedImageEntry;
  const activeIsImage = activeImage?.kind === 'image';
  const totalImages = allLibraryImages.filter((entry) => entry.kind === 'image').length;
  const totalDocuments = allLibraryImages.filter((entry) => entry.kind !== 'image').length;
  const totalArchives = displayTree ? countArchives(displayTree) : 0;
  const imageDisplayStyle = buildImageDisplayStyle(viewerMode, zoomBehavior, imageNaturalSize, stageSize, zoom, rotation);
  const displayZoom = viewerMode === 'fit' ? calculateViewportScale(imageNaturalSize, stageSize, zoomBehavior) * zoom : zoom;

  const shellStyle = { '--library-width': `${libraryWidth}px` } as CSSProperties;

  return (
    <div
      className={`app-shell ${fullscreen ? 'global-view-fullscreen' : ''} ${workspaceOpen ? 'workspace-mode' : 'viewer-mode'} ${libraryCollapsed ? 'library-collapsed' : ''}`}
      style={shellStyle}
      onContextMenu={(event) => event.preventDefault()}
    >
      <aside className="library-panel">
        <div className="brand-bar">
          <div>
            <div className="brand-title">{t.appName}</div>
            <div className="brand-subtitle">
              {totalImages.toLocaleString()} {t.imageCount} · {totalDocuments.toLocaleString()} {t.documentCount} · {totalArchives.toLocaleString()} {t.archiveCount}
            </div>
          </div>
          <div className="brand-actions">
            <button className="icon-button" type="button" title={t.settings} onClick={() => setSettingsOpen(true)}>
              <FontAwesomeIcon icon={faGear} />
            </button>
            <button className="icon-button" type="button" title={t.chooseDirectory} onClick={handleChooseDirectory}>
              <FontAwesomeIcon icon={faFolderOpen} />
            </button>
            <button className="icon-button" type="button" title={t.collapse} onClick={() => setLibraryCollapsed(true)}>
              <FontAwesomeIcon icon={faAngleLeft} />
            </button>
          </div>
        </div>

        <nav className="main-navigation" aria-label={t.workspace}>
          <button className={!workspaceOpen ? 'active' : ''} type="button" onClick={() => setWorkspaceOpen(false)}>
            <FontAwesomeIcon icon={faFileLines} />
            <span>{t.viewerTitle}</span>
          </button>
          <button className={workspaceOpen ? 'active' : ''} type="button" onClick={() => setWorkspaceOpen(true)} disabled={allLibraryImages.length === 0}>
            <FontAwesomeIcon icon={faTableCellsLarge} />
            <span>{t.workspace}</span>
          </button>
        </nav>

        <div className="path-row">
          <input
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void handleScan();
              }
            }}
            placeholder={t.pathPlaceholder}
            spellCheck={false}
          />
          {scanning ? (
            <button className="icon-button" type="button" title={t.stopScan} onClick={handleStopScan}>
              <FontAwesomeIcon icon={faStop} />
            </button>
          ) : (
            <button className="icon-button" type="button" title={t.scan} onClick={() => void handleScan()}>
              <FontAwesomeIcon icon={faMagnifyingGlass} />
            </button>
          )}
        </div>

        <div className="library-status-area">
          <div className="scan-status">
            {scanning ? (
              <span className="scan-current">
                <FontAwesomeIcon icon={faSpinner} spin />
                <span className="scan-current-text" title={currentScanPath || rootPath}>
                  {t.scanning}: {currentScanPath || rootPath}
                </span>
              </span>
            ) : (
              <span className="scan-summary">
                {t.scannedDirectories}: {scannedDirectories.toLocaleString()}
              </span>
            )}
            {scanning ? <em>{t.pendingDirectories}: {pendingDirectories.toLocaleString()}</em> : null}
          </div>
        </div>

        <div className="library-source-tabs" role="tablist" aria-label={t.currentDirectory}>
          <button className={librarySourceTab === 'current' ? 'active' : ''} type="button" role="tab" aria-selected={librarySourceTab === 'current'} onClick={() => setLibrarySourceTab('current')}>
            <FontAwesomeIcon icon={faFolderOpen} />
            <span>{t.currentDirectory}</span>
          </button>
          <button className={librarySourceTab === 'pinned' ? 'active' : ''} type="button" role="tab" aria-selected={librarySourceTab === 'pinned'} onClick={() => setLibrarySourceTab('pinned')}>
            <FontAwesomeIcon icon={faThumbtack} />
            <span>{t.pinnedDirectories}</span>
            {pinnedDirectories.length > 0 ? <em>{pinnedDirectories.length}</em> : null}
          </button>
        </div>

        <div className="tree-scroll">
          {librarySourceTab === 'pinned' ? (
            pinnedDirectories.length > 0 ? (
              <section className="pinned-directories pinned-tab-content" aria-label={t.pinnedDirectories}>
                <div className="pinned-directory-list">
                  {pinnedDirectories.map((directoryPath) => (
                    <div className="pinned-directory-row" key={directoryPath}>
                      <button className="pinned-directory-open" type="button" title={directoryPath} disabled={scanning} onClick={() => openPinnedDirectory(directoryPath)}>
                        <FontAwesomeIcon icon={faFolder} />
                        <span>{pinnedDirectoryName(directoryPath)}</span>
                      </button>
                      <button className="pinned-directory-remove" type="button" title={t.unpinDirectory} onClick={() => togglePinnedDirectory(directoryPath)}>
                        <FontAwesomeIcon icon={faXmark} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : <div className="empty-state compact"><FontAwesomeIcon icon={faThumbtack} /><span>{t.noPinnedDirectories}</span></div>
          ) : displayTree ? (
            <TreeNode
              node={displayTree}
              depth={0}
              selectedNodeId={selectedNode?.id ?? ''}
              selectedImageId={selectedImageId}
              expandedNodeIds={expandedNodeIds}
              labels={{ expand: t.expand, collapse: t.collapse, pin: t.pinDirectory, unpin: t.unpinDirectory }}
              pinnedDirectories={pinnedDirectorySet}
              onSelect={selectTreeNode}
              onSelectImage={(node, image) => {
                setSelectedNodeId(node.id);
                setSelectedImageId(image.id);
              }}
              onToggle={toggleExpanded}
              onTogglePinned={togglePinnedDirectory}
              onOpenNodeContextMenu={openNodeContextMenu}
              onOpenImageContextMenu={openImageContextMenu}
            />
          ) : (
            <div className="empty-state compact">{t.notScanned}</div>
          )}
        </div>
      </aside>

      <div className="library-resizer" role="separator" aria-orientation="vertical" onPointerDown={handleLibraryResizeStart} />

      <main className="viewer-panel">
        <header className="viewer-toolbar">
          <div className="toolbar-title">
            <div className="toolbar-heading">
              {libraryCollapsed ? (
                <button className="icon-button source-panel-toggle" type="button" title={t.expand} onClick={() => setLibraryCollapsed(false)}>
                  <FontAwesomeIcon icon={faAngleRight} />
                </button>
              ) : null}
              <span>{selectedNode?.name ?? t.viewerTitle}</span>
            </div>
            <small>
              {visibleImages.length.toLocaleString()} {t.contentCount}
            </small>
          </div>
          {activeIsImage ? (
            <div className={`toolbar-zoom ${viewerMode === 'fit' ? 'fit-muted' : ''}`}>
              <button className="icon-button" type="button" title={t.zoomOut} onClick={() => changeZoom(-0.1)} disabled={!imagePayload || displayZoom <= 0.1}>
                <FontAwesomeIcon icon={faMinus} />
              </button>
              <span className="zoom-label">{Math.round(displayZoom * 100)}%</span>
              <button className="icon-button" type="button" title={t.zoomIn} onClick={() => changeZoom(0.1)} disabled={!imagePayload || displayZoom >= 8}>
                <FontAwesomeIcon icon={faPlus} />
              </button>
            </div>
          ) : null}
          {documentPayload ? (
            <label className="document-theme-control" title={t.documentTheme}>
              <span>{t.documentTheme}</span>
              <select
                value={documentTheme}
                aria-label={t.documentTheme}
                onChange={(event) => setDocumentTheme(event.target.value as DocumentTheme)}
              >
                {documentThemeOptions.map((theme) => (
                  <option key={theme.value} value={theme.value}>{theme.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="toolbar-window-actions">
            <button className="icon-button" type="button" title={fullscreen ? t.exitFullscreen : t.fullscreen} onClick={() => void handleToggleFullscreen()}>
              <FontAwesomeIcon icon={fullscreen ? faCompress : faExpand} />
            </button>
            {activeIsImage ? (
              <button className="icon-button" type="button" title={t.rotate} onClick={() => setRotation((current) => (current + 90) % 360)} disabled={!imagePayload}>
                <FontAwesomeIcon icon={faRotateRight} />
              </button>
            ) : null}
          </div>
          <div className="toolbar-actions">
            {activeIsImage ? (
              <>
                <button className={`mode-button ${viewerMode === 'fit' ? 'active' : ''}`} type="button" title={t.fit} onClick={() => setViewerMode('fit')}>
                  <FontAwesomeIcon icon={faArrowsToEye} />
                  <span>Fit</span>
                </button>
                <button className={`mode-button ${viewerMode === 'actual' ? 'active' : ''}`} type="button" title={t.actual} onClick={() => setViewerMode('actual')}>
                  <FontAwesomeIcon icon={faImage} />
                  <span>1:1</span>
                </button>
              </>
            ) : null}
            <button className="icon-button" type="button" title={t.previous} onClick={() => moveSelection(-1)} disabled={visibleImages.length === 0}>
              <FontAwesomeIcon icon={faAngleLeft} />
            </button>
            <button className="icon-button" type="button" title={t.next} onClick={() => moveSelection(1)} disabled={visibleImages.length === 0}>
              <FontAwesomeIcon icon={faAngleRight} />
            </button>
          </div>
        </header>

        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

        <section
          ref={imageStageRef}
          className={`image-stage stage-bg-${stageBackground} ${viewerMode} ${fullscreen ? 'view-fullscreen' : ''} ${imagePayload ? 'has-image' : ''} ${documentPayload ? 'has-document' : ''} ${panning ? 'panning' : ''}`}
          onDoubleClick={handleStageDoubleClick}
          onPointerDown={activeIsImage ? handlePanStart : undefined}
          onPointerMove={activeIsImage ? handlePanMove : undefined}
          onPointerUp={activeIsImage ? handlePanEnd : undefined}
          onPointerCancel={activeIsImage ? handlePanEnd : undefined}
          onWheel={activeIsImage ? handleWheelNavigation : undefined}
          onContextMenu={openViewerContextMenu}
        >
          {loadingImage ? (
            <div className="empty-state">
              <FontAwesomeIcon icon={faSpinner} spin />
              <span>{t.loadingImage}</span>
            </div>
          ) : documentPayload ? (
            <article className={`document-viewer document-theme-${documentTheme} ${activeImage?.kind === 'text' ? 'plain-text' : activeImage?.kind === 'markdown' ? 'markdown' : 'code'}`}>
              <header>
                <FontAwesomeIcon icon={faFileLines} />
                <strong>{activeImage?.kind === 'text' ? t.textPreview : activeImage?.kind === 'markdown' ? t.markdownPreview : t.codePreview}</strong>
                <span>{documentPayload.location}</span>
                {supportsDocumentPreview(documentPayload.format) ? (
                  <div className="document-view-mode" role="group">
                    <button className={documentViewMode === 'preview' ? 'active' : ''} type="button" onClick={() => setDocumentViewMode('preview')}>{t.previewView}</button>
                    <button className={documentViewMode === 'raw' ? 'active' : ''} type="button" onClick={() => setDocumentViewMode('raw')}>{t.rawView}</button>
                  </div>
                ) : null}
              </header>
              {documentViewMode === 'raw' && supportsDocumentPreview(documentPayload.format) ? (
                <CodeHighlight code={documentPayload.text} language={languageByFormat(documentPayload.format)} truncatedLabel={t.previewTruncated} />
              ) : documentPayload.format === '.txt' ? (
                <pre>{documentPayload.text}</pre>
              ) : documentPayload.format === '.md' || documentPayload.format === '.markdown' ? (
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
                    skipHtml
                    urlTransform={blockMarkdownUrl}
                    components={{
                      a: ({ children, href }) => <span className="markdown-blocked-link" title={href}>{children}</span>,
                      img: ({ alt }) => <span className="markdown-remote-placeholder">[{alt || t.remoteContentBlocked}]</span>,
                    }}
                  >
                    {limitDocumentPreview(documentPayload.text).text}
                  </ReactMarkdown>
                  {limitDocumentPreview(documentPayload.text).truncated ? <div className="preview-truncated">{t.previewTruncated}</div> : null}
                </div>
              ) : documentPayload.format === '.json' ? (
                <JsonStructuredView
                  text={documentPayload.text}
                  labels={{
                    invalidJson: t.invalidJson,
                    filterRows: t.filterRows,
                    noMatchingRows: t.noMatchingRows,
                    rows: t.rows,
                    columns: t.columns,
                    truncated: t.structuredTruncated,
                  }}
                />
              ) : documentPayload.format === '.csv' || documentPayload.format === '.tsv' ? (
                <DelimitedTableView
                  text={documentPayload.text}
                  delimiter={documentPayload.format === '.tsv' ? '\t' : ','}
                  labels={{
                    invalidJson: t.invalidJson,
                    filterRows: t.filterRows,
                    noMatchingRows: t.noMatchingRows,
                    rows: t.rows,
                    columns: t.columns,
                    truncated: t.structuredTruncated,
                  }}
                />
              ) : (
                <CodeHighlight code={documentPayload.text} language={languageByFormat(documentPayload.format)} truncatedLabel={t.previewTruncated} />
              )}
            </article>
          ) : imagePayload ? (
            <img
              src={imagePayload.dataUri}
              alt={imagePayload.name}
              onLoad={(event) => {
                setImageNaturalSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
                centerActualImage();
              }}
              style={imageDisplayStyle}
              draggable={false}
            />
          ) : (
            <div className="empty-state">
              <FontAwesomeIcon icon={faImage} />
              <span>{t.pickImage}</span>
            </div>
          )}
        </section>

        <footer className="filmstrip">
          <div className="image-meta">
            <strong>{activeImage?.name ?? t.noImage}</strong>
            <span>{activeIsImage ? formatResolution(imageNaturalSize) : activeImage?.format.toUpperCase()}</span>
            <span>{activeImage ? formatBytes(activeImage.size) : ''}</span>
            <span>{activeImage ? `${selectedImageIndex + 1}/${visibleImages.length}` : ''}</span>
            <span>{activeImage ? activeImage.directoryPath : ''}</span>
            <div className="checksum-meta">
              {activeChecksum ? (
                <button type="button" title={t.copyChecksum} onClick={() => copyText(activeChecksum)}>{activeChecksum.slice(0, 14)}…</button>
              ) : (
                <button type="button" title={t.calculateChecksum} onClick={() => void handleCalculateChecksum()} disabled={!activeImage || checksumBusy}>
                  {checksumBusy ? <FontAwesomeIcon icon={faSpinner} spin /> : 'SHA-256'}
                </button>
              )}
            </div>
          </div>
        </footer>
      </main>
      {workspaceOpen ? (
        <div className="workspace-overlay">
          <section className="workspace-dialog" role="region" aria-label={t.workspace}>
            <header className="workspace-header">
              <div className="workspace-title-group">
                {libraryCollapsed ? (
                  <button className="icon-button source-panel-toggle" type="button" title={t.expand} onClick={() => setLibraryCollapsed(false)}>
                    <FontAwesomeIcon icon={faAngleRight} />
                  </button>
                ) : null}
                <div>
                  <strong>{t.workspace}</strong>
                  <span>{t.workspaceSubtitle}</span>
                </div>
              </div>
              <button className="icon-button" type="button" title={t.close} onClick={() => setWorkspaceOpen(false)}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </header>
            <div className="workspace-toolbar">
              <div className="workspace-filters">
                <input
                  value={workspaceQuery}
                  onChange={(event) => setWorkspaceQuery(event.target.value)}
                  placeholder={t.searchContent}
                  type="search"
                />
                <select value={workspaceKindFilter} onChange={(event) => setWorkspaceKindFilter(event.target.value as WorkspaceKindFilter)}>
                  <option value="all">{t.allContent}</option>
                  <option value="image">{t.imagesOnly}</option>
                  <option value="document">{t.documentsOnly}</option>
                </select>
                <select value={workspaceSourceFilter} onChange={(event) => setWorkspaceSourceFilter(event.target.value as WorkspaceSourceFilter)}>
                  <option value="all">{t.allSources}</option>
                  <option value="file">{t.foldersOnly}</option>
                  <option value="archive">{t.archivesOnly}</option>
                </select>
              </div>
              <div className="workspace-command-row">
                <span className="workspace-summary">{t.showingResults}: {filteredWorkspaceImages.length.toLocaleString()} / {allLibraryImages.length.toLocaleString()} · {t.selectedCount}: {selectedWorkspaceImages.length.toLocaleString()}</span>
                <div className="workspace-actions">
                  <button
                    className="workspace-action"
                    type="button"
                    onClick={() => setSelectedWorkspaceImageIds((current) => new Set([...current, ...filteredWorkspaceImages.map((image) => image.id)]))}
                    disabled={filteredWorkspaceImages.length === 0}
                  >
                    {t.selectFiltered}
                  </button>
                  <button className="workspace-action" type="button" onClick={() => setSelectedWorkspaceImageIds(new Set())} disabled={selectedWorkspaceImages.length === 0}>
                    {t.clearSelection}
                  </button>
                  <button className="workspace-action primary" type="button" onClick={() => void handleExportSelected()} disabled={workspaceBusy || selectedWorkspaceImages.length === 0}>
                    <FontAwesomeIcon icon={faFileExport} />
                    {t.exportSelected}
                  </button>
                  <button className="workspace-action" type="button" onClick={() => void handleDetectDuplicates()} disabled={workspaceBusy || filteredWorkspaceImages.length === 0}>
                    <FontAwesomeIcon icon={workspaceBusy ? faSpinner : faClone} spin={workspaceBusy} />
                    {t.detectDuplicates}
                  </button>
                  {workspaceBusy ? (
                    <button className="workspace-action" type="button" onClick={handleCancelWorkspaceOperation}>
                      <FontAwesomeIcon icon={faStop} />
                      {t.cancelOperation}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {workspaceMessage ? <div className="workspace-message">{workspaceMessage}</div> : null}
            <div className={`workspace-content ${duplicateGroups.length > 0 ? 'has-duplicates' : ''}`}>
              <div className="thumbnail-grid">
                {filteredWorkspaceImages.length > 0 ? (
                  <>
                    {displayedWorkspaceImages.map((image) => (
                      <ThumbnailCard
                        key={image.id}
                        image={image}
                        active={image.id === selectedImageId}
                        selected={selectedWorkspaceImageIds.has(image.id)}
                        archiveLabel={t.sourceArchive}
                        folderLabel={t.sourceFolder}
                        onToggle={() => toggleWorkspaceImage(image.id)}
                        onOpen={() => {
                          const imageRef = navigationImages.find((item) => item.image.id === image.id);
                          if (imageRef) {
                            setSelectedNodeId(imageRef.node.id);
                          }
                          setSelectedImageId(image.id);
                        }}
                      />
                    ))}
                    {displayedWorkspaceImages.length < filteredWorkspaceImages.length ? (
                      <div className="thumbnail-grid-actions">
                        <button
                          className="thumbnail-grid-more"
                          type="button"
                          disabled={workspaceLoadTarget !== null}
                          onClick={() => setWorkspaceLoadTarget(Math.min(workspaceDisplayLimit + workspacePageSize, filteredWorkspaceImages.length))}
                        >
                          {t.loadMore} ({displayedWorkspaceImages.length.toLocaleString()} / {filteredWorkspaceImages.length.toLocaleString()})
                        </button>
                        <button
                          className="thumbnail-grid-more secondary"
                          type="button"
                          disabled={workspaceLoadTarget !== null}
                          onClick={() => setWorkspaceLoadTarget(filteredWorkspaceImages.length)}
                        >
                          {t.loadAll}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : <div className="empty-state">{allLibraryImages.length === 0 ? t.workspaceEmpty : t.noMatchingRows}</div>}
              </div>
              <aside className="workspace-inspector">
                <header>
                  <strong>{activeImage?.name ?? t.noImage}</strong>
                  {activeImage ? <span>{activeImage.format.toUpperCase()} · {formatBytes(activeImage.size)}</span> : null}
                </header>
                <div className="workspace-inspector-preview">
                  {loadingImage ? (
                    <FontAwesomeIcon icon={faSpinner} spin />
                  ) : activeImage?.kind === 'image' && imagePayload?.id === activeImage.id ? (
                    <img src={imagePayload.dataUri} alt={activeImage.name} draggable={false} />
                  ) : activeImage && activeImage.kind !== 'image' && documentPayload?.id === activeImage.id ? (
                    <pre>{limitDocumentPreview(documentPayload.text).text.slice(0, 4000)}</pre>
                  ) : (
                    <FontAwesomeIcon icon={activeImage?.kind === 'image' ? faImage : faFileLines} />
                  )}
                </div>
                {activeImage ? (
                  <div className="workspace-inspector-details">
                    <span title={activeImage.directoryPath}>{activeImage.directoryPath}</span>
                    <span>{activeImage.source === 'archive' ? t.sourceArchive : t.sourceFolder}</span>
                    <button className="workspace-action primary" type="button" onClick={() => setWorkspaceOpen(false)}>{t.viewerTitle}</button>
                  </div>
                ) : null}
              </aside>
              {duplicateGroups.length > 0 ? <aside className="duplicate-panel">
                <h3>{t.duplicateGroups} ({duplicateGroups.length.toLocaleString()})</h3>
                {duplicateGroups.map((group, groupIndex) => (
                  <div className="duplicate-group" key={group.hash}>
                    <strong>#{groupIndex + 1} · {group.images.length} · {formatBytes(group.totalBytes)}</strong>
                    {group.images.map((image) => (
                      <button
                        type="button"
                        key={image.id}
                        onClick={() => {
                          setSelectedWorkspaceImageIds((current) => new Set(current).add(image.id));
                          setSelectedImageId(image.id);
                        }}
                      >
                        <FontAwesomeIcon icon={image.source === 'archive' ? faBoxArchive : image.kind === 'image' ? faImage : faFileLines} />
                        <span>{image.name}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </aside> : null}
            </div>
          </section>
        </div>
      ) : null}
      {workspaceLoadTarget !== null ? (
        <div className="workspace-loading-overlay">
          <section className="workspace-loading-dialog" role="alertdialog" aria-modal="true" aria-label={t.loadingItems}>
            <FontAwesomeIcon icon={faSpinner} spin />
            <strong>{t.loadingItems}</strong>
            <span>{t.loadingItemsHint}</span>
            <progress value={displayedWorkspaceImages.length} max={workspaceLoadTarget} />
            <em>{displayedWorkspaceImages.length.toLocaleString()} / {workspaceLoadTarget.toLocaleString()}</em>
            <button className="workspace-action" type="button" onClick={() => setWorkspaceLoadTarget(null)}>
              <FontAwesomeIcon icon={faStop} />
              {t.cancelOperation}
            </button>
          </section>
        </div>
      ) : null}
      {settingsOpen ? (
        <div className="settings-overlay" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-dialog" role="dialog" aria-modal="true" aria-label={t.settings} onMouseDown={(event) => event.stopPropagation()}>
            <header className="settings-header">
              <strong>{t.settings}</strong>
              <button className="icon-button" type="button" title={t.close} onClick={() => setSettingsOpen(false)}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </header>
            <div className="settings-tabs">
              <button className={`settings-tab ${settingsTab === 'display' ? 'active' : ''}`} type="button" onClick={() => setSettingsTab('display')}>
                {t.display}
              </button>
              <button className={`settings-tab ${settingsTab === 'imageFormats' ? 'active' : ''}`} type="button" onClick={() => setSettingsTab('imageFormats')}>
                {t.imageFormats}
              </button>
              <button className={`settings-tab ${settingsTab === 'documentFormats' ? 'active' : ''}`} type="button" onClick={() => setSettingsTab('documentFormats')}>
                {t.documentFormats}
              </button>
              <button className={`settings-tab ${settingsTab === 'about' ? 'active' : ''}`} type="button" onClick={() => setSettingsTab('about')}>
                {t.about}
              </button>
            </div>
            <div className="settings-body">
              {settingsTab === 'display' ? (
                <div className="settings-stack">
                  <label className="settings-row">
                    <span>{t.language}</span>
                    <select value={languagePreference} onChange={(event) => setLanguagePreference(event.target.value as LanguagePreference)}>
                      {Object.entries(localeLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {value === 'auto' ? t.automatic : label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-row">
                    <span>{t.zoomBehavior}</span>
                    <select value={zoomBehavior} onChange={(event) => handleZoomBehaviorChange(event.target.value as ZoomBehavior)}>
                      {Object.entries(zoomBehaviorLabels).map(([value, labelKey]) => (
                        <option key={value} value={value}>
                          {t[labelKey]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-row">
                    <span>{t.stageBackground}</span>
                    <select value={stageBackground} onChange={(event) => setStageBackground(event.target.value as StageBackground)}>
                      {Object.entries(stageBackgroundLabels).map(([value, labelKey]) => (
                        <option key={value} value={value}>
                          {t[labelKey]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : settingsTab === 'imageFormats' ? (
                <div className="settings-stack">
                  <div className="settings-format-header">
                    <span>{t.imageFormats}</span>
                    <div className="settings-format-actions">
                      <button className="settings-link-button" type="button" onClick={() => setEnabledImageExtensions([])}>{t.clearAll}</button>
                      <button className="settings-link-button" type="button" onClick={() => setEnabledImageExtensions([...bootstrap.supportedImages])}>{t.selectAll}</button>
                    </div>
                  </div>
                  <div className="format-grid">
                    {bootstrap.supportedImages.map((extension) => (
                      <label className="format-option" key={extension}>
                        <input
                          type="checkbox"
                          checked={enabledImageExtensions.includes(extension)}
                          onChange={() => toggleImageExtension(extension)}
                        />
                        <span>{extension}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : settingsTab === 'documentFormats' ? (
                <div className="settings-stack">
                  <div className="settings-format-header">
                    <span>{t.documentFormats}</span>
                    <div className="settings-format-actions">
                      <button className="settings-link-button" type="button" onClick={() => setEnabledDocumentExtensions([])}>{t.clearAll}</button>
                      <button className="settings-link-button" type="button" onClick={() => setEnabledDocumentExtensions([...bootstrap.supportedDocuments])}>{t.selectAll}</button>
                    </div>
                  </div>
                  <div className="format-grid document-formats">
                    {bootstrap.supportedDocuments.map((extension) => (
                      <label className="format-option" key={extension}>
                        <input
                          type="checkbox"
                          checked={enabledDocumentExtensions.includes(extension)}
                          onChange={() => toggleDocumentExtension(extension)}
                        />
                        <span>{extension}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="settings-stack">
                  <div className="about-row">
                    <span>{t.hardwareInfo}</span>
                    <strong>{appInfo.hardwareInfo || t.unavailable}</strong>
                  </div>
                  <div className="about-row">
                    <span>{t.osVersion}</span>
                    <strong>{appInfo.osVersion || t.unavailable}</strong>
                  </div>
                  <div className="about-row">
                    <span>{t.appVersion}</span>
                    <strong>{appInfo.appVersion || t.unavailable}</strong>
                  </div>
                  <div className="about-row">
                    <span>{t.buildInfo}</span>
                    <strong>{`${appInfo.tag || 'untagged'} · ${(appInfo.commit || 'unknown').slice(0, 12)} · ${appInfo.buildState || 'unknown'}`}</strong>
                  </div>
                  <div className="about-row">
                    <span>{t.license}</span>
                    <strong>{appInfo.license || 'GNU General Public License v3.0'}</strong>
                  </div>
                  <div className="about-row">
                    <span>{t.sourceCode}</span>
                    <button className="settings-link-button about-source-button" type="button" title={appInfo.sourceUrl} onClick={() => copyText(appInfo.sourceUrl)}>
                      {t.copySourceUrl}
                    </button>
                  </div>
                  <p className="about-license-notice">{t.noWarranty}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="context-menu"
          role="menu"
          aria-label={t.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextMenu.items.map((item, index) => (
            <button
              className="context-menu-item"
              type="button"
              role="menuitem"
              disabled={item.disabled}
              key={`${item.label}-${index}`}
              onClick={() => {
                if (item.disabled) {
                  return;
                }
                closeContextMenu();
                item.action();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface TreeNodeProps {
  node: LibraryNode;
  depth: number;
  selectedNodeId: string;
  selectedImageId: string;
  expandedNodeIds: Set<string>;
  labels: {
    expand: string;
    collapse: string;
    pin: string;
    unpin: string;
  };
  pinnedDirectories: Set<string>;
  onSelect: (node: LibraryNode) => void;
  onSelectImage: (node: LibraryNode, image: ImageEntry) => void;
  onToggle: (nodeId: string) => void;
  onTogglePinned: (directoryPath: string) => void;
  onOpenNodeContextMenu: (event: MouseEvent<HTMLElement>, node: LibraryNode) => void;
  onOpenImageContextMenu: (event: MouseEvent<HTMLElement>, node: LibraryNode, image: ImageEntry) => void;
}

interface ThumbnailCardProps {
  image: ImageEntry;
  active: boolean;
  selected: boolean;
  archiveLabel: string;
  folderLabel: string;
  onToggle: () => void;
  onOpen: () => void;
}

const thumbnailCache = new Map<string, string>();
const maxThumbnailCacheEntries = 200;
const thumbnailVisibilityCallbacks = new WeakMap<Element, () => void>();
let thumbnailVisibilityObserver: IntersectionObserver | null = null;

function observeThumbnailVisibility(element: Element, onVisible: () => void) {
  if (!thumbnailVisibilityObserver) {
    thumbnailVisibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }
          const callback = thumbnailVisibilityCallbacks.get(entry.target);
          thumbnailVisibilityObserver?.unobserve(entry.target);
          thumbnailVisibilityCallbacks.delete(entry.target);
          callback?.();
        });
      },
      { rootMargin: '400px' },
    );
  }
  thumbnailVisibilityCallbacks.set(element, onVisible);
  thumbnailVisibilityObserver.observe(element);
  return () => {
    thumbnailVisibilityObserver?.unobserve(element);
    thumbnailVisibilityCallbacks.delete(element);
  };
}

function getCachedThumbnail(path: string): string {
  const thumbnail = thumbnailCache.get(path);
  if (!thumbnail) {
    return '';
  }
  thumbnailCache.delete(path);
  thumbnailCache.set(path, thumbnail);
  return thumbnail;
}

function ThumbnailCard({ image, active, selected, archiveLabel, folderLabel, onToggle, onOpen }: ThumbnailCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(image.kind !== 'image');
  const [thumbnail, setThumbnail] = useState(() => getCachedThumbnail(image.path));
  const [thumbnailStatus, setThumbnailStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>(() => thumbnail ? 'ready' : 'idle');

  useEffect(() => {
    if (image.kind !== 'image' || visible) {
      return;
    }
    const card = cardRef.current;
    if (!card) {
      return;
    }
    return observeThumbnailVisibility(card, () => setVisible(true));
  }, [image.kind, visible]);

  useEffect(() => {
    if (image.kind !== 'image' || !visible) {
      setThumbnail('');
      return;
    }
    const cached = getCachedThumbnail(image.path);
    if (cached) {
      setThumbnail(cached);
      setThumbnailStatus('ready');
      return;
    }
    let cancelled = false;
    setThumbnailStatus('loading');
    void window.go?.app?.App?.LoadThumbnailByPath?.(image.path, 280)
      .then((payload) => {
        if (!cancelled && payload?.dataUri) {
          thumbnailCache.set(image.path, payload.dataUri);
          while (thumbnailCache.size > maxThumbnailCacheEntries) {
            const oldestKey = thumbnailCache.keys().next().value;
            if (typeof oldestKey !== 'string') {
              break;
            }
            thumbnailCache.delete(oldestKey);
          }
          setThumbnail(payload.dataUri);
          setThumbnailStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setThumbnailStatus('failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [image.kind, image.path, visible]);

  return (
    <article ref={cardRef} className={`thumbnail-card ${active ? 'active' : ''} ${selected ? 'selected' : ''}`} onDoubleClick={onOpen}>
      <button className="thumbnail-select" type="button" onClick={onToggle} aria-pressed={selected}>
        {selected ? <FontAwesomeIcon icon={faCheck} /> : null}
      </button>
      <button className="thumbnail-preview" type="button" onClick={onOpen}>
        {image.kind !== 'image' ? (
          <div className={`document-thumbnail ${image.kind}`}>
            <FontAwesomeIcon icon={faFileLines} />
            <strong>{image.format.replace('.', '').toUpperCase()}</strong>
          </div>
        ) : thumbnailStatus === 'ready' && thumbnail ? <img src={thumbnail} alt="" draggable={false} loading="lazy" />
          : thumbnailStatus === 'loading' ? <FontAwesomeIcon icon={faSpinner} spin />
            : <FontAwesomeIcon icon={faImage} />}
      </button>
      <div className="thumbnail-details">
        <strong title={image.name}>{image.name}</strong>
        <span>
          <FontAwesomeIcon icon={image.source === 'archive' ? faBoxArchive : faFolder} />
          {image.source === 'archive' ? archiveLabel : folderLabel} · {formatBytes(image.size)}
        </span>
      </div>
    </article>
  );
}

function CodeHighlight({ code, language, truncatedLabel }: { code: string; language: string; truncatedLabel: string }) {
  const preview = limitDocumentPreview(normalizeDocumentLineEndings(code));
  const highlighted = highlightSource(preview.text, language);
  const lines = highlighted.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return (
    <>
      <pre className="hljs code-viewer">
        {lines.slice(0, maxRenderedCodeLines).map((line, lineIndex) => (
          <div key={lineIndex} className="code-line">
            <span className="code-line-number">{lineIndex + 1}</span>
            <span className="code-line-content" dangerouslySetInnerHTML={{ __html: line || ' ' }} />
          </div>
        ))}
      </pre>
      {preview.truncated || lines.length > maxRenderedCodeLines ? <div className="preview-truncated code">{truncatedLabel}</div> : null}
    </>
  );
}

function highlightSource(code: string, language: string): string {
  if (language !== 'plaintext' && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  return escapeHTML(code);
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function languageByFormat(format: string): string {
  const languageMap: Record<string, string> = {
    '.go': 'go', '.rs': 'rust', '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
    '.cs': 'csharp', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.swift': 'swift', '.m': 'objectivec', '.mm': 'objectivec',
    '.py': 'python', '.pyw': 'python', '.rb': 'ruby', '.php': 'php', '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
    '.vue': 'html', '.svelte': 'html', '.html': 'html', '.htm': 'html', '.xml': 'xml', '.css': 'css', '.scss': 'scss', '.sass': 'scss', '.less': 'less',
    '.json': 'json', '.jsonc': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.ini': 'ini', '.conf': 'ini', '.config': 'ini',
    '.env': 'bash', '.properties': 'properties', '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
    '.fish': 'bash', '.ps1': 'powershell', '.bat': 'dos', '.cmd': 'dos', '.lua': 'lua', '.pl': 'perl', '.r': 'r', '.dart': 'dart',
    '.ex': 'elixir', '.exs': 'elixir', '.erl': 'erlang', '.hrl': 'erlang', '.fs': 'fsharp', '.fsx': 'fsharp', '.vb': 'visual-basic',
    '.scala': 'scala', '.clj': 'clojure', '.cljs': 'clojure', '.hs': 'haskell', '.lhs': 'haskell', '.sol': 'solidity', '.asm': 'x86asm', '.s': 'x86asm',
    '.dockerfile': 'dockerfile', '.makefile': 'makefile', '.gradle': 'gradle', '.md': 'markdown', '.markdown': 'markdown',
    '.csv': 'plaintext', '.tsv': 'plaintext', '.log': 'plaintext', '.lock': 'plaintext',
  };
  return languageMap[format] ?? 'plaintext';
}

function supportsDocumentPreview(format: string): boolean {
  return format === '.md' || format === '.markdown' || format === '.json' || format === '.csv' || format === '.tsv';
}

function TreeNode({
  node,
  depth,
  selectedNodeId,
  selectedImageId,
  expandedNodeIds,
  labels,
  pinnedDirectories,
  onSelect,
  onSelectImage,
  onToggle,
  onTogglePinned,
  onOpenNodeContextMenu,
  onOpenImageContextMenu,
}: TreeNodeProps) {
  const expanded = expandedNodeIds.has(node.id);
  const hasExpandableItems = node.children.length > 0 || node.images.length > 0;
  const icon = node.kind === 'archive' ? faBoxArchive : expanded && hasExpandableItems ? faFolderOpen : faFolder;
  const imageCount = countImages(node);
  const selectedInCollapsedTree = !expanded && containsImage(node, selectedImageId);
  const selectedClass = selectedNodeId === node.id || selectedInCollapsedTree ? 'selected' : '';
  const pinned = node.kind === 'directory' && pinnedDirectories.has(normalizePinnedDirectory(node.path));

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${selectedClass} ${node.kind === 'archive' ? 'archive-row' : ''}`}
        style={{ paddingLeft: 10 + depth * 18 }}
      >
        <button
          className="expander"
          type="button"
          title={expanded ? labels.collapse : labels.expand}
          onClick={(event) => {
            event.stopPropagation();
            if (hasExpandableItems) {
              onToggle(node.id);
            }
          }}
        >
          {hasExpandableItems ? <FontAwesomeIcon icon={expanded ? faAngleDown : faAngleRight} /> : <span />}
        </button>
        <button className="tree-label" type="button" onClick={() => onSelect(node)} onContextMenu={(event) => onOpenNodeContextMenu(event, node)} title={node.path}>
          <FontAwesomeIcon icon={icon} />
          <span>{node.name}</span>
          <i className={node.kind === 'directory' && !node.scanned ? 'pending-dot' : ''} />
          <em>{imageCount}</em>
        </button>
        {node.kind === 'directory' ? (
          <button
            className={`tree-pin ${pinned ? 'active' : ''}`}
            type="button"
            title={pinned ? labels.unpin : labels.pin}
            aria-pressed={pinned}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePinned(node.path);
            }}
          >
            <FontAwesomeIcon icon={faThumbtack} />
          </button>
        ) : <span className="tree-pin-placeholder" />}
      </div>
      {expanded
        ? (
          <>
            {node.children.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                selectedNodeId={selectedNodeId}
                selectedImageId={selectedImageId}
                expandedNodeIds={expandedNodeIds}
                labels={labels}
                pinnedDirectories={pinnedDirectories}
                onSelect={onSelect}
                onSelectImage={onSelectImage}
                onToggle={onToggle}
                onTogglePinned={onTogglePinned}
                onOpenNodeContextMenu={onOpenNodeContextMenu}
                onOpenImageContextMenu={onOpenImageContextMenu}
              />
            ))}
            {node.images.map((image) => (
              <div
                key={image.id}
                className={`tree-row image-row ${image.id === selectedImageId ? 'selected-image' : ''}`}
                style={{ paddingLeft: 10 + (depth + 1) * 18 }}
              >
                <span className="expander" />
                <button
                  className="tree-label image-label"
                  type="button"
                  onClick={() => onSelectImage(node, image)}
                  onContextMenu={(event) => onOpenImageContextMenu(event, node, image)}
                  title={image.path}
                >
                  <FontAwesomeIcon icon={image.kind === 'image' ? faImage : faFileLines} />
                  <span>{image.name}</span>
                </button>
              </div>
            ))}
          </>
        )
        : null}
    </div>
  );
}

function collectImages(node: LibraryNode): ImageEntry[] {
  return [...node.images, ...node.children.flatMap((child) => collectImages(child))];
}

interface ImageNavigationItem {
  image: ImageEntry;
  node: LibraryNode;
  ancestorIds: string[];
}

function collectImageRefs(node: LibraryNode, ancestorIds: string[] = []): ImageNavigationItem[] {
  const currentAncestors = [...ancestorIds, node.id];
  return [
    ...node.children.flatMap((child) => collectImageRefs(child, currentAncestors)),
    ...node.images.map((image) => ({
      image,
      node,
      ancestorIds,
    })),
  ];
}

function firstImageInTreeOrder(node: LibraryNode): ImageEntry | null {
  for (const child of node.children) {
    const image = firstImageInTreeOrder(child);
    if (image) {
      return image;
    }
  }
  return node.images[0] ?? null;
}

function countImages(node: LibraryNode): number {
  return node.images.length + node.children.reduce((sum, child) => sum + countImages(child), 0);
}

function containsImage(node: LibraryNode, imageId: string): boolean {
  if (!imageId) {
    return false;
  }
  return node.images.some((image) => image.id === imageId) || node.children.some((child) => containsImage(child, imageId));
}

function countArchives(node: LibraryNode): number {
  return (node.kind === 'archive' ? 1 : 0) + node.children.reduce((sum, child) => sum + countArchives(child), 0);
}

function buildVisibleTree(node: LibraryNode | null, isRoot = true): LibraryNode | null {
  if (!node) {
    return null;
  }

  const children = node.children.flatMap((child) => {
    const visibleChild = buildVisibleTree(child, false);
    return visibleChild ? [visibleChild] : [];
  });
  const hasImages = node.images.length > 0 || children.length > 0;
  if (!isRoot && !hasImages && node.scanned) {
    return null;
  }

  return {
    ...node,
    children,
  };
}

function findNode(node: LibraryNode, nodeId: string): LibraryNode | null {
  if (node.id === nodeId) {
    return node;
  }
  for (const child of node.children) {
    const found = findNode(child, nodeId);
    if (found) {
      return found;
    }
  }
  return null;
}

function findImage(node: LibraryNode, imageId: string): ImageEntry | null {
  for (const image of node.images) {
    if (image.id === imageId) {
      return image;
    }
  }
  for (const child of node.children) {
    const found = findImage(child, imageId);
    if (found) {
      return found;
    }
  }
  return null;
}

function mergeScannedNode(current: LibraryNode, scannedNode: LibraryNode): LibraryNode {
  if (current.id === scannedNode.id) {
    const currentChildrenById = new Map(current.children.map((child) => [child.id, child]));
    return {
      ...scannedNode,
      children: scannedNode.children.map((child) => {
        const existing = currentChildrenById.get(child.id);
        if (existing && child.kind === 'directory' && !child.scanned) {
          return {
            ...child,
            scanned: existing.scanned,
            images: existing.images,
            children: existing.children,
          };
        }
        return child;
      }),
    };
  }

  return {
    ...current,
    children: current.children.map((child) => mergeScannedNode(child, scannedNode)),
  };
}

function readPersistedRootPath(): string {
  return localStorage.getItem(storageKeys.rootPath)?.trim() ?? '';
}

function imagePayloadCacheKey(image: ImageEntry): string {
  return `${image.path}\u0000${image.size}`;
}

function getCachedImagePayload(image: ImageEntry): ImagePayload | null {
  const key = imagePayloadCacheKey(image);
  const payload = imagePayloadCache.get(key);
  if (!payload) {
    return null;
  }
  imagePayloadCache.delete(key);
  imagePayloadCache.set(key, payload);
  return payload;
}

function cacheImagePayload(image: ImageEntry, payload: ImagePayload) {
  const key = imagePayloadCacheKey(image);
  const payloadBytes = payload.dataUri.length;
  if (payloadBytes > maxImagePayloadCacheBytes) {
    return;
  }
  const existing = imagePayloadCache.get(key);
  if (existing) {
    imagePayloadCacheBytes -= existing.dataUri.length;
    imagePayloadCache.delete(key);
  }
  imagePayloadCache.set(key, payload);
  imagePayloadCacheBytes += payloadBytes;
  while (imagePayloadCache.size > maxImagePayloadCacheEntries || imagePayloadCacheBytes > maxImagePayloadCacheBytes) {
    const oldestKey = imagePayloadCache.keys().next().value;
    if (typeof oldestKey !== 'string') {
      break;
    }
    const oldestPayload = imagePayloadCache.get(oldestKey);
    imagePayloadCache.delete(oldestKey);
    imagePayloadCacheBytes -= oldestPayload?.dataUri.length ?? 0;
  }
}

function clearImagePayloadCache() {
  imagePayloadCache.clear();
  imagePayloadPrefetches.clear();
  imagePayloadCacheBytes = 0;
  imagePayloadCacheGeneration += 1;
}

async function loadImagePayloadByPath(filePath: string, operationId: number): Promise<ImagePayload> {
  const cancellableLoader = window.go?.app?.App?.LoadImageByPathWithOperation;
  if (cancellableLoader) {
    return cancellableLoader(filePath, operationId);
  }
  const payload = await window.go?.app?.App?.LoadImageByPath?.(filePath);
  if (!payload) {
    throw new Error('Unable to load image');
  }
  return payload;
}

async function decodeImagePayload(payload: ImagePayload): Promise<void> {
  const decoder = new Image();
  decoder.decoding = 'async';
  decoder.src = payload.dataUri;
  if (typeof decoder.decode === 'function') {
    await decoder.decode().catch(() => undefined);
    return;
  }
  await new Promise<void>((resolve) => {
    decoder.onload = () => resolve();
    decoder.onerror = () => resolve();
  });
}

function prefetchImagePayload(image: ImageEntry, operationId: number): Promise<ImagePayload | null> {
  const cachedPayload = getCachedImagePayload(image);
  if (cachedPayload) {
    return Promise.resolve(cachedPayload);
  }
  const key = imagePayloadCacheKey(image);
  const pending = imagePayloadPrefetches.get(key);
  if (pending) {
    return pending;
  }
  const generation = imagePayloadCacheGeneration;
  const request = loadImagePayloadByPath(image.path, operationId)
    .then(async (payload) => {
      await decodeImagePayload(payload);
      if (generation === imagePayloadCacheGeneration) {
        cacheImagePayload(image, payload);
      }
      return payload;
    })
    .catch(() => null)
    .finally(() => {
      imagePayloadPrefetches.delete(key);
    });
  imagePayloadPrefetches.set(key, request);
  return request;
}

async function readLibraryCache(rootPath: string): Promise<PersistedLibraryCache | null> {
  const loadLibraryCache = window.go?.app?.App?.LoadLibraryCache;
  if (loadLibraryCache) {
    try {
      const diskPayload = await loadLibraryCache(rootPath);
      const diskCache = parseLibraryCache(diskPayload, rootPath);
      if (diskCache) {
        return diskCache;
      }
    } catch {
    }
  }

  try {
    const raw = localStorage.getItem(storageKeys.libraryCache);
    const legacyCache = parseLibraryCache(raw ?? '', rootPath);
    if (legacyCache && window.go?.app?.App?.SaveLibraryCache) {
      await window.go.app.App.SaveLibraryCache(rootPath, JSON.stringify(legacyCache));
      localStorage.removeItem(storageKeys.libraryCache);
    }
    return legacyCache;
  } catch {
    return null;
  }
}

async function writeLibraryCache(cache: PersistedLibraryCache) {
  const payload = JSON.stringify(cache);
  const saveLibraryCache = window.go?.app?.App?.SaveLibraryCache;
  if (saveLibraryCache) {
    try {
      await saveLibraryCache(cache.rootPath, payload);
      localStorage.removeItem(storageKeys.libraryCache);
      return;
    } catch {
    }
  }
  try {
    localStorage.setItem(storageKeys.libraryCache, payload);
  } catch {
    localStorage.removeItem(storageKeys.libraryCache);
  }
}

function parseLibraryCache(raw: string, rootPath: string): PersistedLibraryCache | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as PersistedLibraryCache;
    if (!parsed?.tree || parsed.rootPath !== rootPath || !Array.isArray(parsed.expandedNodeIds)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readLibrarySelection(rootPath: string): PersistedLibrarySelection | null {
  try {
    const raw = localStorage.getItem(storageKeys.librarySelection);
    const parsed = raw ? JSON.parse(raw) as PersistedLibrarySelection : null;
    return parsed?.rootPath === rootPath ? parsed : null;
  } catch {
    return null;
  }
}

function writeLibrarySelection(selection: PersistedLibrarySelection) {
  try {
    localStorage.setItem(storageKeys.librarySelection, JSON.stringify(selection));
  } catch {
    return;
  }
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return fallback;
}

function isOperationCancelled(error: unknown): boolean {
  return extractErrorMessage(error, '').includes('操作已取消');
}

function formatResolution(naturalSize: { width: number; height: number }): string {
  if (naturalSize.width <= 0 || naturalSize.height <= 0) {
    return '';
  }
  return `${naturalSize.width} x ${naturalSize.height}`;
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function writeImagePayloadToClipboard(payload: ImagePayload): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    await copyDataUriText(payload.dataUri);
    return;
  }

  try {
    const pngBlob = await dataUriToPngBlob(payload.dataUri);
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': pngBlob,
      }),
    ]);
  } catch {
    await copyDataUriText(payload.dataUri);
  }
}

async function copyDataUriText(dataUri: string): Promise<void> {
  await ClipboardSetText(dataUri)
    .catch(() => navigator.clipboard?.writeText(dataUri).then(() => true));
}

function dataUriToPngBlob(dataUri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Canvas is unavailable'));
        return;
      }
      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Image clipboard conversion failed'));
      }, 'image/png');
    };
    image.onerror = () => reject(new Error('Image clipboard conversion failed'));
    image.src = dataUri;
  });
}

function buildImageDisplayStyle(
  viewerMode: ViewerMode,
  zoomBehavior: ZoomBehavior,
  naturalSize: { width: number; height: number },
  stageSize: { width: number; height: number },
  zoom: number,
  rotation: number,
): CSSProperties {
  if (naturalSize.width <= 0 || naturalSize.height <= 0) {
    return { transform: `rotate(${rotation}deg)` };
  }

  const baseScale = viewerMode === 'fit' ? calculateViewportScale(naturalSize, stageSize, zoomBehavior) : 1;
  const displayScale = Math.max(0.01, baseScale * zoom);

  return {
    width: naturalSize.width * displayScale,
    height: naturalSize.height * displayScale,
    maxWidth: 'none',
    maxHeight: 'none',
    flex: '0 0 auto',
    transform: `rotate(${rotation}deg)`,
  };
}

function calculateViewportScale(
  naturalSize: { width: number; height: number },
  stageSize: { width: number; height: number },
  zoomBehavior: ZoomBehavior,
): number {
  if (naturalSize.width <= 0 || naturalSize.height <= 0 || stageSize.width <= 0 || stageSize.height <= 0) {
    return 1;
  }
  if (zoomBehavior === 'lockRatio') {
    return 1;
  }
  const fitScale = Math.min(stageSize.width / naturalSize.width, stageSize.height / naturalSize.height);
  if (zoomBehavior === 'shrinkLarge') {
    return Math.min(1, fitScale);
  }
  return fitScale;
}

function clampZoom(value: number): number {
  return Math.min(8, Math.max(0.1, value));
}

function clampContextMenuPosition(x: number, y: number): { x: number; y: number } {
  const menuWidth = 220;
  const menuHeight = 260;
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - menuWidth - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - menuHeight - margin)),
  };
}

function normalizePinnedDirectory(directoryPath: string): string {
  const trimmedPath = directoryPath.trim();
  if (!trimmedPath) {
    return '';
  }
  return trimmedPath.replace(/\/+$/, '') || '/';
}

function pinnedDirectoryName(directoryPath: string): string {
  const normalizedPath = normalizePinnedDirectory(directoryPath);
  if (normalizedPath === '/') {
    return '/';
  }
  return normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
}

function readPinnedDirectories(): string[] {
  try {
    const raw = localStorage.getItem(storageKeys.pinnedDirectories);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return Array.from(new Set(parsed
      .filter((path): path is string => typeof path === 'string')
      .map(normalizePinnedDirectory)
      .filter(Boolean)))
      .slice(0, 30);
  } catch {
    return [];
  }
}

function resolveInitialLanguagePreference(): LanguagePreference {
  const stored = localStorage.getItem(storageKeys.locale);
  if (stored === 'auto' || stored === 'zh-TW' || stored === 'en' || stored === 'ja') {
    return stored;
  }
  return 'auto';
}

function resolveInitialStageBackground(): StageBackground {
  const stored = localStorage.getItem(storageKeys.stageBackground);
  if (stored === 'light') {
    return 'lightGray';
  }
  if (stored === 'dark') {
    return 'darkGray';
  }
  if (stored === 'lightGray' || stored === 'white' || stored === 'darkGray' || stored === 'black' || stored === 'checker') {
    return stored;
  }
  return 'checker';
}

function resolveInitialZoomBehavior(): ZoomBehavior {
  const stored = localStorage.getItem(storageKeys.zoomBehavior);
  if (stored === 'fitArea' || stored === 'shrinkLarge' || stored === 'lockRatio') {
    return stored;
  }
  return 'fitArea';
}

function resolveInitialDocumentTheme(): DocumentTheme {
  const stored = localStorage.getItem(storageKeys.documentTheme);
  if (stored === 'github-dark' || stored === 'github-light' || stored === 'atom-one-dark' || stored === 'nord' || stored === 'monokai') {
    return stored;
  }
  return 'github-dark';
}

function resolveInitialEnabledImageExtensions(): string[] {
  try {
    const raw = localStorage.getItem(storageKeys.enabledImageExtensions);
    if (!raw) {
      return [...fallbackBootstrap.supportedImages];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...fallbackBootstrap.supportedImages];
    }
    return normalizeEnabledExtensions(parsed, fallbackBootstrap.supportedImages);
  } catch {
    return [...fallbackBootstrap.supportedImages];
  }
}

function resolveInitialEnabledDocumentExtensions(): string[] {
  return readStoredEnabledExtensions(storageKeys.enabledDocumentExtensions, fallbackBootstrap.supportedDocuments) ?? [];
}

function readStoredEnabledExtensions(storageKey: string, supportedExtensions: string[]): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return normalizeEnabledExtensions(parsed, supportedExtensions);
  } catch {
    return null;
  }
}

function normalizeExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function normalizeEnabledExtensions(extensions: unknown[], supportedExtensions: string[]): string[] {
  const supported = supportedExtensions.map(normalizeExtension).filter(Boolean);
  const supportedSet = new Set(supported);
  const selectedSet = new Set<string>();

  for (const extension of extensions) {
    if (typeof extension !== 'string') {
      continue;
    }
    const normalized = normalizeExtension(extension);
    if (supportedSet.has(normalized)) {
      selectedSet.add(normalized);
    }
  }

  return supported.filter((extension) => selectedSet.has(extension));
}

function resolveLocale(languagePreference: LanguagePreference): LocaleCode {
  if (languagePreference !== 'auto') {
    return languagePreference;
  }
  const browserLocale = navigator.language.toLowerCase();
  if (browserLocale.startsWith('ja')) {
    return 'ja';
  }
  if (browserLocale.startsWith('zh')) {
    return 'zh-TW';
  }
  return 'en';
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
