export type NodeKind = 'directory' | 'archive';
export type ImageSource = 'file' | 'archive';
export type EntryKind = 'image' | 'text' | 'markdown' | 'code' | 'video' | 'audio' | 'subtitle';
export type MediaEntryKind = 'video' | 'audio' | 'subtitle';
export type ViewerMode = 'fit' | 'actual';
export type ZoomBehavior = 'fitArea' | 'shrinkLarge' | 'lockRatio';
export type LocaleCode = 'zh-TW' | 'en' | 'ja';
export type LanguagePreference = 'auto' | LocaleCode;
export type StageBackground = 'lightGray' | 'white' | 'darkGray' | 'black' | 'checker';
export type DocumentTheme = 'github-dark' | 'github-light' | 'atom-one-dark' | 'nord' | 'monokai';
export type SettingsTab = 'display' | 'imageFormats' | 'documentFormats' | 'mediaFormats' | 'about';

export interface BootstrapPayload {
  defaultPath: string;
  supportedImages: string[];
  supportedDocuments: string[];
  supportedMedia: string[];
  supportedPacks: string[];
}

export interface DirectoryScanResult {
  rootPath: string;
  node: LibraryNode | null;
  warnings: string[];
}

export interface LibraryNode {
  id: string;
  name: string;
  path: string;
  kind: NodeKind;
  scanned: boolean;
  images: ImageEntry[];
  children: LibraryNode[];
}

export interface ImageEntry {
  id: string;
  name: string;
  path: string;
  directoryPath: string;
  source: ImageSource;
  archivePath?: string;
  innerPath?: string;
  format: string;
  kind: EntryKind;
  size: number;
}

export interface ImagePayload {
  id: string;
  name: string;
  mime: string;
  dataUri: string;
  source: ImageSource;
  location: string;
}

export interface DocumentPayload {
  id: string;
  name: string;
  text: string;
  format: string;
  source: ImageSource;
  location: string;
}

export interface DuplicateGroup {
  hash: string;
  totalBytes: number;
  images: ImageEntry[];
}

export interface ExportResult {
  destination: string;
  exported: number;
  skipped: number;
}

export interface AppInfo {
  hardwareInfo: string;
  osVersion: string;
  appVersion: string;
  commit: string;
  tag: string;
  buildState: string;
  sourceUrl: string;
  license: string;
}

export type DownloadStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface DownloadItem {
  id: string;
  url: string;
  name: string;
  path: string;
  status: DownloadStatus;
  contentType: string;
  bytes: number;
  totalBytes: number;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface HLSCandidate {
  url: string;
  name: string;
}

export interface DownloadResolution {
  sourceUrl: string;
  name: string;
  candidates: HLSCandidate[];
}

export function isMediaKind(kind: EntryKind): kind is MediaEntryKind {
  return kind === 'video' || kind === 'audio' || kind === 'subtitle';
}

export function isPlaybackMediaKind(kind: EntryKind): kind is 'video' | 'audio' {
  return kind === 'video' || kind === 'audio';
}
