import { Injectable } from '@angular/core';
import { Observable, concat, delay, map, of } from 'rxjs';
import {
  WhitecapDuplicateStrategy,
  WhitecapFileItem,
  WhitecapFilePage,
  WhitecapFileQuery,
  WhitecapOperationResult,
  WhitecapStorageProvider,
  WhitecapUploadFileInput,
  WhitecapUploadOptions,
  WhitecapUploadProgress,
} from 'whitecap-file-manager';
import workOrderTreeRoot from './work-order-mock-tree.json';

/** SharePoint-style drive item as returned by the work-order API (demo JSON). */
export interface WorkOrderDriveItemDto {
  id: string;
  name: string;
  webUrl: string;
  itemType: 'Directory' | 'File';
  createdDateTime: string;
  lastModifiedDateTime: string;
  size: number;
  parentReferenceId: string | null;
  driveId: string;
  siteId: string;
  listId: string;
  listItemId: string | null;
  children: WorkOrderDriveItemDto[] | null;
  itemMetadata: Record<string, unknown> | null;
}

function normalizePath(path: string): string {
  const withRoot = `/${path}`.replace(/\/+/g, '/');
  return withRoot.length > 1 && withRoot.endsWith('/') ? withRoot.slice(0, -1) : withRoot;
}

function joinPath(parentPath: string, name: string): string {
  if (parentPath === '/') {
    return `/${name}`;
  }
  return `${parentPath}/${name}`;
}

function extensionFromName(name: string): string | undefined {
  if (!name.includes('.')) {
    return undefined;
  }
  return name.split('.').at(-1);
}

function mapDtoToFileItem(dto: WorkOrderDriveItemDto, parentPath: string): WhitecapFileItem {
  const path = joinPath(parentPath, dto.name);
  const isFolder = dto.itemType === 'Directory';
  const rawChildren = dto.children ?? [];
  const childCount = isFolder ? rawChildren.length : undefined;
  const hasChildren = isFolder ? rawChildren.length > 0 : undefined;

  return {
    id: dto.id,
    name: dto.name,
    path,
    parentPath: normalizePath(parentPath),
    type: isFolder ? 'folder' : 'file',
    size: dto.size,
    createdAt: dto.createdDateTime,
    modifiedAt: dto.lastModifiedDateTime,
    extension: isFolder ? undefined : extensionFromName(dto.name),
    downloadUrl: isFolder ? undefined : dto.webUrl,
    hasChildren,
    childCount,
    metadata: {
      webUrl: dto.webUrl,
      driveId: dto.driveId,
      siteId: dto.siteId,
      listId: dto.listId,
      listItemId: dto.listItemId,
      parentReferenceId: dto.parentReferenceId,
      itemType: dto.itemType,
      itemMetadata: dto.itemMetadata,
    },
  };
}

function buildItemsMap(root: WorkOrderDriveItemDto): Map<string, WhitecapFileItem[]> {
  const items = new Map<string, WhitecapFileItem[]>();

  const visit = (node: WorkOrderDriveItemDto, parentPath: string): void => {
    const rawChildren = node.children ?? [];
    const mapped = rawChildren.map((child) => mapDtoToFileItem(child, parentPath));
    items.set(normalizePath(parentPath), mapped);
    for (const child of rawChildren) {
      if (child.itemType === 'Directory') {
        visit(child, joinPath(parentPath, child.name));
      }
    }
  };

  visit(root, '/');
  return items;
}

/**
 * Demo storage that mirrors production work-order / SharePoint tree JSON:
 * nested `children`, `itemType` Directory/File, and rich `metadata` for each row.
 */
@Injectable({ providedIn: 'root' })
export class ProductionLikeMockStorageProvider implements WhitecapStorageProvider {
  readonly capabilities = {
    supportsTree: true,
    supportsFolderUpload: true,
    supportsPagination: true,
    supportsPreview: true,
  };

  private readonly items = buildItemsMap(workOrderTreeRoot as WorkOrderDriveItemDto);

  list(query: WhitecapFileQuery): Observable<WhitecapFilePage> {
    const path = normalizePath(query.path);
    const source = query.flatFiles ? this.collectAllFilesUnder(path) : (this.items.get(path) ?? []);
    const search = (query.search ?? '').toLowerCase();
    const filters = query.filters;
    const filtered = source.filter((item) => {
      if (search && !item.name.toLowerCase().includes(search)) {
        return false;
      }
      if (filters?.fileTypes?.length) {
        if (item.type === 'folder') {
          return false;
        }
        const ext = (item.extension ?? '').toLowerCase();
        const allowed = filters.fileTypes.map((value) => value.toLowerCase().replace(/^\./, ''));
        if (!allowed.includes(ext)) {
          return false;
        }
      }
      if (filters?.owner) {
        if ((item.owner ?? '').toLowerCase() !== filters.owner.toLowerCase()) {
          return false;
        }
      }
      if (filters?.dateFrom) {
        if (!item.modifiedAt || new Date(item.modifiedAt).valueOf() < new Date(filters.dateFrom).valueOf()) {
          return false;
        }
      }
      if (filters?.dateTo) {
        if (!item.modifiedAt || new Date(item.modifiedAt).valueOf() > new Date(filters.dateTo).valueOf()) {
          return false;
        }
      }
      return true;
    });
    const sorted = filtered.slice().sort((a, b) => this.compareBy(query.sortBy ?? 'name', query.sortDirection ?? 'asc', a, b));
    const total = sorted.length;
    const pageIndex = query.pagination?.pageIndex ?? 0;
    const pageSize = query.pagination?.pageSize ?? total;
    const start = Math.max(0, pageIndex * pageSize);
    const paged = pageSize > 0 ? sorted.slice(start, start + pageSize) : sorted;
    return of({ items: paged, total }).pipe(delay(120));
  }

  preview(item: WhitecapFileItem): Observable<Blob | string> {
    if (item.extension === 'png' || item.extension === 'jpg' || item.extension === 'jpeg') {
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 160'><rect width='240' height='160' fill='%23fff4ec'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-size='14' fill='%23ea580c'>${item.name}</text></svg>`;
      return of(new Blob([decodeURIComponent(svg)], { type: 'image/svg+xml' })).pipe(delay(60));
    }
    const content = `Preview of ${item.path}\n\n(Production-like mock — metadata keys: ${Object.keys(item.metadata ?? {}).join(', ')}.)`;
    return of(content).pipe(delay(60));
  }

  tree(path = '/'): Observable<WhitecapFileItem[]> {
    const rootPath = normalizePath(path);
    const folders = this.collectFolders(rootPath).map((folder) => ({
      ...folder,
      childCount: (this.items.get(folder.path) ?? []).length,
    }));
    return of(folders).pipe(delay(80));
  }

  createFolder(path: string, name: string): Observable<WhitecapOperationResult<WhitecapFileItem>> {
    const parentPath = normalizePath(path);
    const next = this.folder(name, parentPath);
    const parentItems = this.items.get(parentPath) ?? [];
    this.items.set(parentPath, parentItems.concat(next));
    this.items.set(next.path, []);
    return of({ data: next }).pipe(delay(80));
  }

  upload(options: WhitecapUploadOptions): Observable<WhitecapUploadProgress> {
    const uploadRoot = normalizePath(options.path);
    const duplicateStrategy = options.duplicateStrategy ?? 'rename';
    const specs = options.files.map((entry: WhitecapUploadFileInput) =>
      entry instanceof File ? { file: entry } : entry,
    );

    const emissions = specs.map((spec, specIndex) => {
      const { file, relativePath } = spec;
      const rel = relativePath?.replace(/\\/g, '/').replace(/^\/+/, '').trim();
      const displayName = rel ?? file.name;
      const uploadId = `wcfm-prod-mock-upload-${specIndex}`;

      return concat(
        of(this.progress(displayName, 10, 'uploading', uploadId)),
        of(this.progress(displayName, 65, 'uploading', uploadId)).pipe(delay(120)),
        of(this.progress(displayName, 100, 'completed', uploadId)).pipe(
          delay(200),
          map((done) => {
            const { parentPath, leafName } = this.resolveUploadTarget(uploadRoot, rel, file.name);
            const resolved = this.resolveUploadName(parentPath, leafName, duplicateStrategy);
            if (!resolved) {
              return {
                ...done,
                status: 'failed',
                error: {
                  code: 'duplicate_skipped',
                  message: `${displayName} skipped due to duplicate name policy.`,
                },
              } as WhitecapUploadProgress;
            }

            const items = this.items.get(parentPath) ?? [];
            if (resolved.replace) {
              this.items.set(
                parentPath,
                items.map((entry) =>
                  entry.name === resolved.finalName && entry.type === 'file'
                    ? this.file(resolved.finalName, parentPath, file.size)
                    : entry,
                ),
              );
            } else {
              this.items.set(parentPath, items.concat(this.file(resolved.finalName, parentPath, file.size)));
            }

            let finalLabel = resolved.finalName;
            if (rel?.includes('/')) {
              finalLabel = `${rel.slice(0, rel.lastIndexOf('/'))}/${resolved.finalName}`;
            }
            return { ...done, fileName: finalLabel, uploadId };
          }),
        ),
      );
    });

    return concat(...emissions);
  }

  download(item: WhitecapFileItem): Observable<Blob> {
    const content = `Download placeholder for ${item.path}\n(driveItem id: ${item.id})\n`;
    return of(new Blob([content], { type: 'text/plain' })).pipe(delay(40));
  }

  rename(item: WhitecapFileItem, newName: string): Observable<WhitecapOperationResult<WhitecapFileItem>> {
    const nextPath = `${item.parentPath ?? ''}/${newName}`.replace(/\/+/g, '/');
    const next = { ...item, name: newName, path: nextPath };
    this.replaceItem(item, next);
    return of({ data: next }).pipe(delay(80));
  }

  delete(items: WhitecapFileItem[]): Observable<WhitecapOperationResult<void>> {
    for (const item of items) {
      const parentItems = (this.items.get(item.parentPath ?? '/') ?? []).filter((entry) => entry.id !== item.id);
      this.items.set(item.parentPath ?? '/', parentItems);
      if (item.type === 'folder') {
        this.items.delete(item.path);
      }
    }
    return of({}).pipe(delay(100));
  }

  move(items: WhitecapFileItem[], targetPath: string): Observable<WhitecapOperationResult<WhitecapFileItem[]>> {
    const moved: WhitecapFileItem[] = [];
    const normalizedTarget = normalizePath(targetPath);

    for (const item of items) {
      const next: WhitecapFileItem = {
        ...item,
        parentPath: normalizedTarget,
        path: `${normalizedTarget}/${item.name}`.replace(/\/+/g, '/'),
      };
      this.removeFromParent(item);
      this.items.set(normalizedTarget, (this.items.get(normalizedTarget) ?? []).concat(next));
      moved.push(next);
    }

    return of({ data: moved }).pipe(delay(100));
  }

  copy(items: WhitecapFileItem[], targetPath: string): Observable<WhitecapOperationResult<WhitecapFileItem[]>> {
    const normalizedTarget = normalizePath(targetPath);
    const copied = items.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      parentPath: normalizedTarget,
      path: `${normalizedTarget}/${item.name}`.replace(/\/+/g, '/'),
    }));
    this.items.set(normalizedTarget, (this.items.get(normalizedTarget) ?? []).concat(copied));
    return of({ data: copied }).pipe(delay(120));
  }

  private compareBy(
    sortBy: NonNullable<WhitecapFileQuery['sortBy']>,
    direction: NonNullable<WhitecapFileQuery['sortDirection']>,
    a: WhitecapFileItem,
    b: WhitecapFileItem,
  ): number {
    const multiplier = direction === 'asc' ? 1 : -1;

    if (sortBy === 'size') {
      return ((a.size ?? 0) - (b.size ?? 0)) * multiplier;
    }

    if (sortBy === 'modifiedAt') {
      return (new Date(a.modifiedAt ?? 0).valueOf() - new Date(b.modifiedAt ?? 0).valueOf()) * multiplier;
    }

    if (sortBy === 'type') {
      return a.type.localeCompare(b.type) * multiplier;
    }

    return a.name.localeCompare(b.name) * multiplier;
  }

  private removeFromParent(item: WhitecapFileItem): void {
    const parentPath = item.parentPath ?? '/';
    this.items.set(
      parentPath,
      (this.items.get(parentPath) ?? []).filter((entry) => entry.id !== item.id),
    );
  }

  private replaceItem(previous: WhitecapFileItem, next: WhitecapFileItem): void {
    const parentPath = previous.parentPath ?? '/';
    const parentItems = this.items.get(parentPath) ?? [];
    this.items.set(
      parentPath,
      parentItems.map((entry) => (entry.id === previous.id ? next : entry)),
    );
  }

  private file(name: string, parentPath: string, size: number): WhitecapFileItem {
    const modified = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      name,
      parentPath: normalizePath(parentPath),
      path: `${normalizePath(parentPath)}/${name}`.replace(/\/+/g, '/'),
      type: 'file',
      size,
      modifiedAt: modified,
      createdAt: modified,
      extension: extensionFromName(name),
      mimeType: 'application/octet-stream',
      metadata: { synthetic: true },
    };
  }

  private folder(name: string, parentPath: string): WhitecapFileItem {
    return {
      id: crypto.randomUUID(),
      name,
      parentPath: normalizePath(parentPath),
      path: `${normalizePath(parentPath)}/${name}`.replace(/\/+/g, '/'),
      type: 'folder',
      hasChildren: false,
      childCount: 0,
      modifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      metadata: { synthetic: true },
    };
  }

  private progress(
    fileName: string,
    percent: number,
    status: WhitecapUploadProgress['status'],
    uploadId: string,
  ): WhitecapUploadProgress {
    return {
      fileName,
      uploadId,
      loaded: percent,
      total: 100,
      percent,
      status,
    };
  }

  private collectAllFilesUnder(rootPath: string): WhitecapFileItem[] {
    const out: WhitecapFileItem[] = [];
    const visit = (dir: string): void => {
      for (const entry of this.items.get(dir) ?? []) {
        if (entry.type === 'file') {
          out.push(entry);
        } else {
          visit(entry.path);
        }
      }
    };
    visit(normalizePath(rootPath));
    return out;
  }

  private collectFolders(startPath: string): WhitecapFileItem[] {
    const result: WhitecapFileItem[] = [];
    const queue = [startPath];
    const visited = new Set<string>();

    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);

      const folders = (this.items.get(current) ?? []).filter((item) => item.type === 'folder');
      for (const folder of folders) {
        result.push(folder);
        queue.push(folder.path);
      }
    }

    return result;
  }

  private resolveUploadTarget(
    uploadRoot: string,
    relativePath: string | undefined,
    fallbackFileName: string,
  ): { parentPath: string; leafName: string } {
    if (!relativePath) {
      return { parentPath: uploadRoot, leafName: fallbackFileName };
    }
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length === 0) {
      return { parentPath: uploadRoot, leafName: fallbackFileName };
    }
    if (segments.length === 1) {
      return { parentPath: uploadRoot, leafName: segments[0]! };
    }
    const dirPortion = segments.slice(0, -1).join('/');
    const parentPath = this.ensureFolderChain(uploadRoot, dirPortion);
    const leafName = segments[segments.length - 1]!;
    return { parentPath, leafName };
  }

  private ensureFolderChain(basePath: string, relativeDir: string): string {
    const segments = relativeDir.split(/[/\\]/).filter(Boolean);
    let current = basePath;
    for (const seg of segments) {
      const children = this.items.get(current) ?? [];
      let existing = children.find((c) => c.type === 'folder' && c.name === seg);
      if (!existing) {
        existing = this.folder(seg, current);
        this.items.set(current, children.concat(existing));
        this.items.set(existing.path, []);
      }
      current = existing.path;
    }
    return current;
  }

  private resolveUploadName(
    path: string,
    originalName: string,
    strategy: WhitecapDuplicateStrategy,
  ): { finalName: string; replace: boolean } | null {
    const existingNames = new Set((this.items.get(path) ?? []).map((item) => item.name));
    if (!existingNames.has(originalName)) {
      return { finalName: originalName, replace: false };
    }

    if (strategy === 'replace') {
      return { finalName: originalName, replace: true };
    }

    if (strategy === 'skip') {
      return null;
    }

    if (strategy === 'ask') {
      return null;
    }

    const baseName = originalName.includes('.') ? originalName.slice(0, originalName.lastIndexOf('.')) : originalName;
    const extension = originalName.includes('.') ? originalName.slice(originalName.lastIndexOf('.')) : '';
    let suffix = 1;
    let candidate = `${baseName} (${suffix})${extension}`;
    while (existingNames.has(candidate)) {
      suffix += 1;
      candidate = `${baseName} (${suffix})${extension}`;
    }
    return { finalName: candidate, replace: false };
  }
}
