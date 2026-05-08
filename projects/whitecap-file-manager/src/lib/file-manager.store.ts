import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, forkJoin, map, Observable, of, Subscription } from 'rxjs';
import {
  WhitecapDuplicateStrategy,
  WhitecapFileItem,
  WhitecapFileQuery,
  WhitecapOperationError,
  WhitecapOperationResult,
  WhitecapSortDirection,
  WhitecapSortField,
  WhitecapStorageProvider,
  WhitecapUploadFileInput,
  WhitecapUploadProgress,
  WhitecapViewMode,
} from './models';

export type WhitecapFilters = NonNullable<WhitecapFileQuery['filters']>;

/** One slot per kind so different operations stack; the same kind updates in place. */
export type WhitecapToastKind =
  | 'create-folder'
  | 'rename'
  | 'delete'
  | 'move'
  | 'copy'
  | 'upload'
  | 'download';

export interface WhitecapToast {
  readonly kind: WhitecapToastKind;
  readonly message: string;
  readonly variant: 'success' | 'error';
}

export function normalizePath(path: string): string {
  if (!path) {
    return '/';
  }

  const normalized = `/${path}`.replace(/\/+/g, '/');
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

export function joinChildPath(parent: string, name: string): string {
  const p = normalizePath(parent);
  const seg = name.trim().replace(/^\/+|\/+$/g, '');
  if (!seg) {
    return p;
  }
  if (p === '/') {
    return `/${seg}`;
  }
  return `${p}/${seg}`;
}

function uploadProgressRowIndex(
  current: WhitecapUploadProgress[],
  progress: WhitecapUploadProgress,
): number {
  if (progress.uploadId) {
    return current.findIndex((item) => item.uploadId === progress.uploadId);
  }
  return current.findIndex((item) => !item.uploadId && item.fileName === progress.fileName);
}

/**
 * Resolves the path to open when entering a folder from the main listing.
 * Some adapters incorrectly set `path` to the parent directory; this derives `/parent/name` when needed.
 */
export function resolveFolderNavigatePath(item: WhitecapFileItem, listPath: string): string {
  const listNorm = normalizePath(listPath);
  const declared = normalizePath(item.path ?? '');
  const parentNorm = normalizePath(item.parentPath ?? listNorm);
  const expectedFromParent = joinChildPath(parentNorm, item.name);

  if (!item.path?.trim() || declared === parentNorm || declared === listNorm) {
    return expectedFromParent;
  }
  if (parentNorm === listNorm && declared !== expectedFromParent) {
    return expectedFromParent;
  }
  return declared;
}

@Injectable()
export class FileManagerStore {
  private readonly destroyRef = inject(DestroyRef);

  readonly provider = signal<WhitecapStorageProvider | null>(null);
  readonly currentPath = signal<string>('/');
  readonly search = signal<string>('');
  readonly sortBy = signal<WhitecapSortField>('name');
  readonly sortDirection = signal<WhitecapSortDirection>('asc');
  readonly viewMode = signal<WhitecapViewMode>('list');
  /** When true, the main pane lists all descendant files under `/` (see `WhitecapFileQuery.flatFiles`). */
  readonly flatFilesMode = signal<boolean>(false);
  readonly loading = signal<boolean>(false);
  readonly error = signal<WhitecapOperationError | null>(null);
  readonly toasts = signal<WhitecapToast[]>([]);
  readonly uploadProgress = signal<WhitecapUploadProgress[]>([]);
  readonly items = signal<WhitecapFileItem[]>([]);
  readonly treeItems = signal<WhitecapFileItem[]>([]);
  /** Direct children under `/` (files + folders); null if unknown (e.g. list failed). Used for the tree Root row. */
  readonly treeRootEntryCount = signal<number | null>(null);
  readonly treeLoading = signal<boolean>(false);
  readonly treeError = signal<WhitecapOperationError | null>(null);
  readonly total = signal<number>(0);
  readonly selectedIds = signal<Set<string>>(new Set<string>());
  readonly filters = signal<WhitecapFilters>({});
  readonly pageIndex = signal<number>(0);
  readonly pageSize = signal<number>(50);

  readonly selectedItems = computed(() => this.items().filter((item) => this.selectedIds().has(item.id)));
  readonly pageCount = computed(() => {
    const size = this.pageSize();
    if (size <= 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(this.total() / size));
  });
  readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.fileTypes?.length || f.owner || f.dateFrom || f.dateTo);
  });
  readonly breadcrumbs = computed(() => {
    const path = this.currentPath();
    if (path === '/') {
      return [{ label: 'Root', path: '/' }];
    }

    const parts = path.split('/').filter(Boolean);
    return [{ label: 'Root', path: '/' }].concat(
      parts.map((part, index) => ({
        label: part,
        path: `/${parts.slice(0, index + 1).join('/')}`,
      })),
    );
  });

  private listSub?: Subscription;
  private treeSub?: Subscription;
  private serverRefreshSub?: Subscription;
  private readonly toastTimers = new Map<WhitecapToastKind, ReturnType<typeof setTimeout>>();
  private readonly toastDismissMs = 4500;

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const timer of this.toastTimers.values()) {
        clearTimeout(timer);
      }
      this.toastTimers.clear();
    });
  }

  setProvider(provider: WhitecapStorageProvider): void {
    this.provider.set(provider);
    this.flatFilesMode.set(false);
    this.refreshTree();
  }

  setPath(path: string): void {
    const normalized = normalizePath(path);
    if (this.flatFilesMode() && normalized !== this.currentPath()) {
      this.flatFilesMode.set(false);
    }
    this.currentPath.set(normalized);
    this.selectedIds.set(new Set<string>());
    this.pageIndex.set(0);
    this.refresh();
  }

  setSearch(search: string): void {
    this.search.set(search.trim());
    this.pageIndex.set(0);
    this.refresh();
  }

  setSort(sortBy: WhitecapSortField): void {
    if (this.sortBy() === sortBy) {
      this.sortDirection.update((value) => (value === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortBy.set(sortBy);
      this.sortDirection.set('asc');
    }
    this.refresh();
  }

  setFilters(filters: WhitecapFilters): void {
    this.filters.set(filters);
    this.pageIndex.set(0);
    this.refresh();
  }

  clearFilters(): void {
    this.filters.set({});
    this.pageIndex.set(0);
    this.refresh();
  }

  setPage(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.pageCount() - 1));
    if (clamped === this.pageIndex()) {
      return;
    }
    this.pageIndex.set(clamped);
    this.refresh();
  }

  setPageSize(size: number): void {
    if (size <= 0 || size === this.pageSize()) {
      return;
    }
    this.pageSize.set(size);
    this.pageIndex.set(0);
    this.refresh();
  }

  setViewMode(viewMode: WhitecapViewMode): void {
    if (viewMode === 'grid' && this.flatFilesMode()) {
      this.flatFilesMode.set(false);
      this.pageIndex.set(0);
      this.viewMode.set(viewMode);
      this.refresh();
      return;
    }
    this.viewMode.set(viewMode);
  }

  setFlatFilesMode(enabled: boolean): void {
    if (enabled === this.flatFilesMode()) {
      return;
    }
    this.flatFilesMode.set(enabled);
    this.pageIndex.set(0);
    if (enabled) {
      this.viewMode.set('list');
      this.currentPath.set(normalizePath('/'));
      this.selectedIds.set(new Set<string>());
    }
    this.refresh();
  }

  /**
   * Transient toast by operation kind. Different kinds stack; repeated updates for the same kind
   * replace that row and reset the dismiss timer.
   */
  showToast(kind: WhitecapToastKind, message: string, variant: 'success' | 'error' = 'success'): void {
    const prev = this.toastTimers.get(kind);
    if (prev !== undefined) {
      clearTimeout(prev);
    }

    this.toasts.update((list) => {
      const index = list.findIndex((t) => t.kind === kind);
      const entry: WhitecapToast = { kind, message, variant };
      if (index === -1) {
        return list.concat(entry);
      }
      const next = list.slice();
      next[index] = entry;
      return next;
    });

    const timer = setTimeout(() => {
      this.toastTimers.delete(kind);
      this.toasts.update((list) => list.filter((t) => t.kind !== kind));
    }, this.toastDismissMs);
    this.toastTimers.set(kind, timer);
  }

  toggleSelection(item: WhitecapFileItem): void {
    this.selectedIds.update((existing) => {
      const next = new Set(existing);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }

  clearSelection(): void {
    this.selectedIds.set(new Set<string>());
  }

  selectAllCurrentItems(): void {
    this.selectedIds.set(new Set(this.items().map((item) => item.id)));
  }

  refresh(): void {
    const provider = this.provider();
    if (!provider) {
      return;
    }

    const filters = this.filters();
    const hasFilters = !!(filters.fileTypes?.length || filters.owner || filters.dateFrom || filters.dateTo);
    const query: WhitecapFileQuery = {
      path: this.flatFilesMode() ? '/' : this.currentPath(),
      flatFiles: this.flatFilesMode() ? true : undefined,
      search: this.search() || undefined,
      sortBy: this.sortBy(),
      sortDirection: this.sortDirection(),
      filters: hasFilters ? filters : undefined,
      pagination: {
        pageIndex: this.pageIndex(),
        pageSize: this.pageSize(),
      },
    };

    this.listSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.listSub = provider
      .list(query)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.items.set(page.items);
          this.total.set(page.total ?? page.items.length);
          this.selectedIds.set(new Set<string>());
          this.refreshTree();
        },
        error: () => {
          this.error.set({ code: 'list_failed', message: 'Could not load folder contents.' });
        },
      });
  }

  hardRefresh(): void {
    const provider = this.provider();
    if (!provider?.refresh) {
      this.refresh();
      return;
    }
    this.serverRefreshSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.serverRefreshSub = provider.refresh().subscribe({
      next: () => this.refresh(),
      error: () => {
        this.loading.set(false);
        this.error.set({ code: 'refresh_failed', message: 'Could not refresh from server.' });
      },
    });
  }

  refreshTree(): void {
    const provider = this.provider();
    if (!provider?.tree) {
      this.treeSub?.unsubscribe();
      this.treeItems.set([]);
      this.treeRootEntryCount.set(null);
      this.treeError.set(null);
      return;
    }

    this.treeSub?.unsubscribe();
    this.treeLoading.set(true);
    this.treeError.set(null);

    const rootTotal$ = provider
      .list({
        path: '/',
        sortBy: 'name',
        sortDirection: 'asc',
        pagination: { pageIndex: 0, pageSize: 1 },
      })
      .pipe(
        map((page) => page.total ?? page.items.length),
        catchError(() => of(null)),
      );

    this.treeSub = forkJoin({
      tree: provider.tree('/'),
      rootTotal: rootTotal$,
    })
      .pipe(finalize(() => this.treeLoading.set(false)))
      .subscribe({
        next: ({ tree, rootTotal }) => {
          this.treeItems.set(tree.filter((item) => item.type === 'folder'));
          this.treeRootEntryCount.set(rootTotal);
        },
        error: () => {
          this.treeItems.set([]);
          this.treeRootEntryCount.set(null);
          this.treeError.set({ code: 'tree_failed', message: 'Could not load folder tree.' });
        },
      });
  }

  createFolder(name: string, onDone?: (result: WhitecapOperationResult<WhitecapFileItem>) => void): void {
    this.runResultOperation(
      (provider) => provider.createFolder(this.currentPath(), name),
      'create-folder',
      'Folder created.',
      'Folder creation failed.',
      onDone,
    );
  }

  renameItem(item: WhitecapFileItem, newName: string, onDone?: (result: WhitecapOperationResult<WhitecapFileItem>) => void): void {
    this.runResultOperation((provider) => provider.rename(item, newName), 'rename', 'Item renamed.', 'Rename failed.', onDone);
  }

  deleteSelected(onDone?: (result: WhitecapOperationResult<void>) => void): void {
    const selected = this.selectedItems();
    if (!selected.length) {
      return;
    }
    this.runResultOperation((provider) => provider.delete(selected), 'delete', 'Items deleted.', 'Delete failed.', onDone);
  }

  moveSelected(targetPath: string, onDone?: (result: WhitecapOperationResult<WhitecapFileItem[]>) => void): void {
    const selected = this.selectedItems();
    if (!selected.length) {
      return;
    }
    this.runResultOperation((provider) => provider.move(selected, normalizePath(targetPath)), 'move', 'Items moved.', 'Move failed.', onDone);
  }

  copySelected(targetPath: string, onDone?: (result: WhitecapOperationResult<WhitecapFileItem[]>) => void): void {
    const selected = this.selectedItems();
    if (!selected.length) {
      return;
    }
    this.runResultOperation((provider) => provider.copy(selected, normalizePath(targetPath)), 'copy', 'Items copied.', 'Copy failed.', onDone);
  }

  downloadSelected(onFile?: (fileName: string, blob: Blob) => void): void {
    const provider = this.provider();
    if (!provider) {
      return;
    }

    for (const item of this.selectedItems().filter((selectedItem) => selectedItem.type === 'file')) {
      provider.download(item).subscribe({
        next: (blob) => onFile?.(item.name, blob),
        error: () => {
          this.showToast('download', `Download failed for ${item.name}.`, 'error');
        },
      });
    }
  }

  upload(files: WhitecapUploadFileInput[], onDone?: (progress: WhitecapUploadProgress) => void): void {
    this.uploadWithStrategy(files, 'rename', onDone);
  }

  uploadWithStrategy(
    files: WhitecapUploadFileInput[],
    duplicateStrategy: WhitecapDuplicateStrategy,
    onDone?: (progress: WhitecapUploadProgress) => void,
  ): void {
    const provider = this.provider();
    if (!provider || !files.length) {
      return;
    }

    this.uploadProgress.set([]);
    provider
      .upload({ path: this.currentPath(), files, duplicateStrategy })
      .subscribe({
        next: (progress) => {
          this.uploadProgress.update((current) => {
            const index = uploadProgressRowIndex(current, progress);
            if (index === -1) {
              return current.concat(progress);
            }
            return current.map((item, itemIndex) => (itemIndex === index ? progress : item));
          });
          onDone?.(progress);

          if (progress.status === 'completed') {
            this.refresh();
          }
        },
        error: () => {
          this.showToast('upload', 'Upload failed.', 'error');
        },
      });
  }

  /** Removes finished rows (completed or failed) from the upload list; in-flight rows stay. */
  clearFinishedUploads(): void {
    this.uploadProgress.update((list) => list.filter((e) => e.status === 'pending' || e.status === 'uploading'));
  }

  /** Closes the upload panel and clears all rows immediately. */
  dismissUploadPanel(): void {
    this.uploadProgress.set([]);
  }

  private runResultOperation<T>(
    operation: (provider: WhitecapStorageProvider) => Observable<WhitecapOperationResult<T>>,
    toastKind: WhitecapToastKind,
    successMessage: string,
    failureMessage: string,
    onDone?: (result: WhitecapOperationResult<T>) => void,
  ): void {
    const provider = this.provider();
    if (!provider) {
      return;
    }

    operation(provider).subscribe({
      next: (result) => {
        if (result.error) {
          this.showToast(toastKind, result.error.message || failureMessage, 'error');
        } else {
          this.showToast(toastKind, successMessage);
          this.refresh();
          this.refreshTree();
        }
        onDone?.(result);
      },
      error: () => {
        this.showToast(toastKind, failureMessage, 'error');
      },
    });
  }
}
