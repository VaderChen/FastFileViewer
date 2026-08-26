import type { AppInfo, BootstrapPayload, DirectoryScanResult, DocumentPayload, DownloadItem, DownloadResolution, DuplicateGroup, ExportResult, ImageEntry, ImagePayload, MoveResult, TrashResult } from './types';

declare global {
  interface Window {
    go?: {
      app?: {
        // App 是圖庫服務：掃描、縮圖、文件與可取消操作。
        App?: {
          Bootstrap: () => Promise<BootstrapPayload>;
          BeginOperation: () => Promise<number>;
          CancelOperation: (operationId: number) => Promise<void>;
          CalculateChecksum: (entry: ImageEntry, operationId: number) => Promise<string>;
          FinishOperation: (operationId: number) => Promise<void>;
          GetAppInfo: () => Promise<AppInfo>;
          LoadLibraryCache: (rootPath: string) => Promise<string>;
          SaveLibraryCache: (rootPath: string, payload: string) => Promise<void>;
          SelectDirectory: (dialogTitle: string) => Promise<string>;
          ResetLibrary: () => Promise<void>;
          ScanDirectory: (directoryPath: string, enabledImageExtensions: string[], enabledDocumentExtensions: string[], enabledMediaExtensions: string[], operationId: number) => Promise<DirectoryScanResult>;
          LoadImage: (id: string) => Promise<ImagePayload>;
          LoadImageByPath: (filePath: string) => Promise<ImagePayload>;
          LoadImageByPathWithOperation: (filePath: string, operationId: number) => Promise<ImagePayload>;
          LoadDocumentByPath: (filePath: string) => Promise<DocumentPayload>;
          LoadThumbnailByPath: (filePath: string, maxDimension: number) => Promise<ImagePayload>;
          ExportImages: (images: ImageEntry[], dialogTitle: string, operationId: number) => Promise<ExportResult>;
          DetectDuplicates: (images: ImageEntry[], operationId: number) => Promise<DuplicateGroup[]>;
          PrepareDocumentByPath: (filePath: string, operationId: number) => Promise<string>;
        };
        // MediaService 負責播放前的解壓、改封裝與播放快取。
        MediaService?: {
          PrepareMediaByPath: (filePath: string, operationId: number) => Promise<string>;
          PrepareCompatibleMediaByPath: (filePath: string, operationId: number) => Promise<string>;
          ReleasePlaybackCache: (filePath: string) => Promise<void>;
          ConfirmRemuxedOriginalCleanup: (
            filePath: string,
            title: string,
            message: string,
            confirmLabel: string,
            cancelLabel: string,
          ) => Promise<ImageEntry>;
          PrepareDocumentByPath: (filePath: string, operationId: number) => Promise<string>;
        };
        FileService?: {
          RenameEntry: (filePath: string, newName: string) => Promise<ImageEntry>;
          TrashEntries: (filePaths: string[]) => Promise<TrashResult>;
          ConfirmTrashEntries: (filePaths: string[], title: string, message: string, confirmLabel: string, cancelLabel: string) => Promise<TrashResult>;
          MoveEntries: (filePaths: string[], destination: string) => Promise<MoveResult>;
          SelectMoveDestination: (dialogTitle: string) => Promise<string>;
        };
        // DownloadService 負責下載佇列與歷史紀錄。
        DownloadService?: {
          StartDownload: (url: string) => Promise<DownloadItem>;
          ResolveDownloadURL: (url: string) => Promise<DownloadResolution>;
          StartResolvedDownload: (sourceUrl: string, hlsUrl: string, preferredName: string) => Promise<DownloadItem>;
          ListDownloads: () => Promise<DownloadItem[]>;
          CancelDownload: (id: string) => Promise<void>;
          RemoveDownload: (id: string) => Promise<void>;
          RevealDownload: (id: string) => Promise<void>;
          OpenDownloadsDirectory: () => Promise<void>;
        };
      };
    };
  }
}

export {};
