import { Observable } from 'rxjs';

export type WhitecapFileType = 'file' | 'folder';

export type WhitecapDuplicateStrategy = 'ask' | 'replace' | 'rename' | 'skip';

export type WhitecapSortField = 'name' | 'type' | 'size' | 'modifiedAt';

export type WhitecapSortDirection = 'asc' | 'desc';

export type WhitecapViewMode = 'list' | 'grid';

export interface WhitecapOperationError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface WhitecapFileItem {
  id: string;
  name: string;
  path: string;
  parentPath?: string;
  type: WhitecapFileType;
  extension?: string;
  mimeType?: string;
  size?: number;
  owner?: string;
  modifiedAt?: string;
  createdAt?: string;
  /** When set (e.g. by `tree`/`list`), number of direct children (files and folders) in this folder. */
  childCount?: number;
  hasChildren?: boolean;
  thumbnailUrl?: string;
  downloadUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface WhitecapFileQuery {
  path: string;
  /**
   * When true, list every descendant **file** under `path` in a single flat result set (folders omitted).
   * Pagination and sorting apply to that flattened list. Providers should honor this when possible.
   */
  flatFiles?: boolean;
  search?: string;
  sortBy?: WhitecapSortField;
  sortDirection?: WhitecapSortDirection;
  filters?: {
    fileTypes?: string[];
    owner?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  pagination?: {
    pageIndex: number;
    pageSize: number;
  };
}

export interface WhitecapFilePage {
  items: WhitecapFileItem[];
  total?: number;
}

/** One file in an upload batch; `relativePath` preserves nested layout under the upload target folder. */
export interface WhitecapUploadFileSpec {
  file: File;
  /** POSIX path under the upload directory, e.g. `icons/logo.svg`. Omit for a flat upload (basename only). */
  relativePath?: string;
}

/** Pass `File` for a flat upload, or `{ file, relativePath }` to recreate folders. */
export type WhitecapUploadFileInput = File | WhitecapUploadFileSpec;

export interface WhitecapUploadOptions {
  path: string;
  files: WhitecapUploadFileInput[];
  duplicateStrategy?: WhitecapDuplicateStrategy;
}

export interface WhitecapUploadValidationIssue {
  fileName: string;
  error: WhitecapOperationError;
}

export interface WhitecapUploadProgress {
  fileName: string;
  /**
   * Stable id for this file within the current upload batch. Use when `fileName` can change
   * (e.g. duplicate rename) so the UI can merge progress updates into one row.
   */
  uploadId?: string;
  loaded: number;
  total: number;
  percent: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: WhitecapOperationError;
}

export interface WhitecapOperationResult<T = void> {
  data?: T;
  error?: WhitecapOperationError;
  warnings?: WhitecapOperationError[];
}

export interface WhitecapProviderCapabilities {
  supportsTree?: boolean;
  supportsFolderUpload?: boolean;
  supportsPreview?: boolean;
  supportsPagination?: boolean;
}

export interface WhitecapStorageProvider {
  capabilities?: WhitecapProviderCapabilities;
  list(query: WhitecapFileQuery): Observable<WhitecapFilePage>;
  tree?(path?: string): Observable<WhitecapFileItem[]>;
  /** Called by the toolbar Refresh button to force a server-side reload before re-listing. */
  refresh?(): Observable<void>;
  createFolder(path: string, name: string): Observable<WhitecapOperationResult<WhitecapFileItem>>;
  upload(options: WhitecapUploadOptions): Observable<WhitecapUploadProgress>;
  download(item: WhitecapFileItem): Observable<Blob>;
  rename(item: WhitecapFileItem, newName: string): Observable<WhitecapOperationResult<WhitecapFileItem>>;
  delete(items: WhitecapFileItem[]): Observable<WhitecapOperationResult<void>>;
  move(items: WhitecapFileItem[], targetPath: string): Observable<WhitecapOperationResult<WhitecapFileItem[]>>;
  copy(items: WhitecapFileItem[], targetPath: string): Observable<WhitecapOperationResult<WhitecapFileItem[]>>;
  preview?(item: WhitecapFileItem): Observable<Blob | string>;
}

export interface WhitecapToolbarAction {
  id: string;
  label: string;
  icon?: string;
}

export interface WhitecapUploadValidationConfig {
  maxFileSizeBytes?: number;
  acceptedMimeTypes?: string[];
  acceptedExtensions?: string[];
  validator?: (file: File) => WhitecapOperationError | null;
}
