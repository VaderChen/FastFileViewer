import type { AppInfo, BootstrapPayload, DirectoryScanResult, DocumentPayload, DuplicateGroup, ExportResult, ImageEntry, ImagePayload } from './types';

declare global {
  interface Window {
    go?: {
      app?: {
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
          PrepareMediaByPath: (filePath: string) => Promise<string>;
          LoadThumbnailByPath: (filePath: string, maxDimension: number) => Promise<ImagePayload>;
          ExportImages: (images: ImageEntry[], dialogTitle: string, operationId: number) => Promise<ExportResult>;
          DetectDuplicates: (images: ImageEntry[], operationId: number) => Promise<DuplicateGroup[]>;
        };
      };
    };
  }
}

export {};
