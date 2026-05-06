You are a senior Angular library architect. Build a production-ready Angular library named `whitecap-file-manager` for internal company use.

## Product Intent

Deliver a reusable, signal-first Angular file manager component with clean APIs and adapter-driven backend integration.

Primary benchmark: replicate the functional feature set of Syncfusion Angular File Manager for internal company usage, while keeping an original codebase and design system implementation.

This implementation must be original. Do not copy source code, templates, or proprietary styling from commercial file manager products.

Parity definition:
- Target functional parity and API ergonomics where practical.
- Do not target byte-for-byte API compatibility.
- Visual parity is not required; UX capability parity is required.

## Platform and Tooling Requirements

- Target Angular `^21` when available; otherwise use the latest stable Angular and keep code forward-compatible with Angular 21.
- Use standalone APIs only.
- Use Angular signals for component state and `computed` signals for derived state.
- Use RxJS where stream semantics are required (HTTP, upload progress, provider streams, cancellation).
- Use Tailwind CSS for component styling.
- Library package name: `whitecap-file-manager`.
- Public component selector: `whitecap-file-manager`.

## Packaging and Workspace Structure

Create an Angular workspace with:
- `projects/whitecap-file-manager` (library)
- `projects/demo` (internal demo app)
- public exports via `projects/whitecap-file-manager/src/public-api.ts`

Package goals:
- Buildable and consumable as an Angular library.
- Ready for internal npm/private registry publishing.
- Semantic versioning-friendly public API.

## Scope by Delivery Phase

### Phase 1 (MVP - required now)

Must-have for Phase 1 (non-negotiable):
- Drag-and-drop upload for files and folders (when browser supports directory upload APIs).
- Multi-select.
- Move and copy operations.
- Download.

Core operations:
- Browse folder contents.
- Create folder.
- Upload files and folders (multi-file/folder supported where available).
- Download files.
- Rename.
- Move.
- Copy.
- Delete.
- Multi-select.

Navigation and data interaction:
- Breadcrumb navigation.
- Refresh current location.
- Search within current path (provider-driven).
- Sort by name, type, size, modified date.
- Grid and list/details views.

Upload UX:
- Drag-and-drop upload for files and folders.
- Upload progress feedback.
- Duplicate-name strategy support (`ask | replace | rename | skip`).
- File size and file type validation hooks.

UI states:
- Loading state.
- Empty state.
- Error state.
- Confirmation dialogs for destructive operations.
- Toast or inline notifications for operation outcomes.
- Context menu for core item operations.
- Toolbar with configurable default actions.

Developer extensibility:
- Stable public data model and provider abstraction.
- REST adapter baseline.
- Event hooks for major user actions and file operations.
- Configurable toolbar actions (add/remove/override actions).

### Phase 2 (deferred, design for extension)

- Folder tree/sidebar.
- Drag-and-drop move in explorer surface.
- File preview subsystem (image/PDF/text) and metadata panel.
- Advanced filters (owner/date/file type combinations).
- Pagination and virtual scrolling strategy.
- GraphQL adapter implementation or stub package.
- Mobile-specific interaction refinements.

## Syncfusion Parity Checklist

Use this list as the feature benchmark for roadmap tracking:
- File and folder operations: upload, download, rename, move, copy, delete.
- Search.
- Layouts: large icons/grid and details/list.
- Context menu.
- Toolbar.
- Multiple selection.
- Responsive behavior.
- Provider flexibility (local/REST/cloud adapters).

Parity target by phase:
- Phase 1: implement the most-used operational and UX features needed for daily internal workflows.
- Phase 2: close remaining parity gaps (tree/preview/advanced filters/pagination strategy).

## Non-Functional Requirements

- Performance:
  - Avoid unnecessary re-renders; favor signal-driven derivation.
  - Keep UI responsive during large operation batches.
- Reliability:
  - Consistent error handling model across provider operations.
  - Graceful partial-failure messaging for batch operations.
- Testability:
  - Unit tests for core state/service logic.
  - Integration tests for main user flows in demo app.

## API Contracts (Phase 1 baseline)

Define these public models and interfaces:

```ts
export type WhitecapFileType = 'file' | 'folder';

export type WhitecapDuplicateStrategy = 'ask' | 'replace' | 'rename' | 'skip';

export interface WhitecapOperationError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface WhitecapFileItem {
  id: string; // Stable unique identifier from provider.
  name: string;
  path: string; // Absolute normalized path (e.g. "/docs/report.pdf").
  parentPath?: string; // Undefined only for root.
  type: WhitecapFileType;
  extension?: string;
  mimeType?: string;
  size?: number;
  owner?: string;
  modifiedAt?: string; // ISO-8601 string.
  createdAt?: string; // ISO-8601 string.
  hasChildren?: boolean; // Relevant for folders.
  thumbnailUrl?: string;
  downloadUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface WhitecapFileQuery {
  path: string; // Normalized absolute path.
  search?: string;
  sortBy?: 'name' | 'type' | 'size' | 'modifiedAt';
  sortDirection?: 'asc' | 'desc';
  filters?: {
    fileTypes?: string[];
    owner?: string;
    dateFrom?: string; // ISO-8601.
    dateTo?: string; // ISO-8601.
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

export interface WhitecapUploadOptions {
  path: string;
  files: File[];
  duplicateStrategy?: WhitecapDuplicateStrategy;
}

export interface WhitecapUploadProgress {
  fileName: string;
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

  createFolder(path: string, name: string): Observable<WhitecapOperationResult<WhitecapFileItem>>;
  upload(options: WhitecapUploadOptions): Observable<WhitecapUploadProgress>;
  download(item: WhitecapFileItem): Observable<Blob>;
  rename(item: WhitecapFileItem, newName: string): Observable<WhitecapOperationResult<WhitecapFileItem>>;
  delete(items: WhitecapFileItem[]): Observable<WhitecapOperationResult<void>>;
  move(items: WhitecapFileItem[], targetPath: string): Observable<WhitecapOperationResult<WhitecapFileItem[]>>;
  copy(items: WhitecapFileItem[], targetPath: string): Observable<WhitecapOperationResult<WhitecapFileItem[]>>;
  preview?(item: WhitecapFileItem): Observable<Blob | string>;
}
```

## Event Hooks (Phase 1 required)

Expose hooks/events for:
- `fileOpened`
- `folderChanged`
- `uploadStarted`
- `uploadCompleted`
- `uploadFailed`
- `fileDeleted`
- `fileRenamed`
- `fileMoved`
- `fileCopied`
- `selectionChanged`

## MVP Acceptance Criteria

Phase 1 is complete when:
- All Phase 1 operations are functional in the demo app with a sample provider.
- Drag-and-drop upload for files and folders works in supported browsers.
- Multi-select, move, copy, and download flows are fully working end-to-end.
- Public API is exported from `public-api.ts` and documented with usage examples.
- State is primarily signal-based; RxJS is used only where stream behavior is needed.
- Destructive actions require confirmation and show success/failure feedback.
- Basic test coverage exists for provider integration and core interactions.
- A documented parity matrix exists showing Phase 1 delivered features and remaining gaps against Syncfusion benchmark capabilities.

## Implementation Guidance

- Prioritize clean architecture and extensibility over feature volume.
- Avoid over-engineering: implement stable extension points now, defer advanced behavior to Phase 2.
- Keep internal naming and file organization consistent and predictable for long-term ownership.
