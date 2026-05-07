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

function normalizePath(path: string): string {
  const withRoot = `/${path}`.replace(/\/+/g, '/');
  return withRoot.length > 1 && withRoot.endsWith('/') ? withRoot.slice(0, -1) : withRoot;
}

@Injectable({ providedIn: 'root' })
export class MockStorageProvider implements WhitecapStorageProvider {
  readonly capabilities = {
    supportsTree: true,
    supportsFolderUpload: true,
    supportsPagination: true,
    supportsPreview: true,
  };

  private readonly items = new Map<string, WhitecapFileItem[]>();
  private readonly uploadedFiles = new Map<string, File>();
  private readonly owners = ['Alice Tan', 'Brett Lo', 'Casey Quinn', 'Dao Lin'];

  constructor() {
    this.items.set('/', [
      this.folder('docs', '/'),
      this.folder('images', '/'),
      this.folder('email', '/'),
      this.file('readme.md', '/'),
      this.file('roadmap.pdf', '/'),
    ]);

    const docs: WhitecapFileItem[] = [
      this.file('q1-report.csv', '/docs'),
      this.file('q2-report.csv', '/docs'),
      this.file('retrospective.txt', '/docs'),
      this.file('roadmap-2026.pdf', '/docs'),
      this.file('hiring-plan.pdf', '/docs'),
    ];
    for (let i = 1; i <= 70; i += 1) {
      docs.push(this.file(`note-${String(i).padStart(3, '0')}.txt`, '/docs'));
    }
    this.items.set('/docs', docs);
    this.items.set('/images', [
      this.file('banner.png', '/images'),
      this.file('logo.svg', '/images'),
      this.file('hero.jpg', '/images'),
    ]);
    this.items.set('/email', [
      this.file('project-kickoff.eml', '/email'),
      this.file('weekly-update.eml', '/email'),
      this.file('invoice-april.eml', '/email'),
    ]);
  }

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
    const uploaded = this.uploadedFiles.get(item.path);
    if (uploaded) {
      return of(uploaded).pipe(delay(60));
    }

    const ext = item.extension?.toLowerCase();

    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'svg') {
      const color = ext === 'svg' ? '%230ea5e9' : '%23ea580c';
      const bg = ext === 'svg' ? '%23e0f2fe' : '%23fff4ec';
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 160'><rect width='240' height='160' fill='${bg}'/><text x='50%' y='45%' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-size='14' fill='${color}'>${item.name}</text><text x='50%' y='65%' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-size='11' fill='${color}' opacity='0.7'>${(item.size ?? 0) > 1024 ? Math.round((item.size ?? 0) / 1024) + ' KB' : (item.size ?? 0) + ' B'}</text></svg>`;
      return of(new Blob([decodeURIComponent(svg)], { type: 'image/svg+xml' })).pipe(delay(60));
    }

    if (ext === 'pdf') {
      // Minimal valid single-page PDF with placeholder text
      const pdfContent = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 80>>
stream
BT /F1 18 Tf 72 700 Td (${item.name}) Tj 0 -30 Td /F1 12 Tf (Mock PDF — demo provider) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f\r
0000000009 00000 n\r
0000000058 00000 n\r
0000000115 00000 n\r
0000000266 00000 n\r
0000000396 00000 n\r
trailer<</Size 6/Root 1 0 R>>
startxref
471
%%EOF`;
      return of(new Blob([pdfContent], { type: 'application/pdf' })).pipe(delay(80));
    }

    if (ext === 'eml') {
      const subjects: Record<string, string> = {
        'project-kickoff.eml': 'Project Kickoff — Q3 Initiative',
        'weekly-update.eml': 'Weekly Status Update — May 5',
        'invoice-april.eml': 'Invoice #2026-0042 for April Services',
      };
      const subject = subjects[item.name] ?? `Re: ${item.name}`;
      const emlContent = [
        `From: Alice Tan <alice.tan@example.com>`,
        `To: Brett Lo <brett.lo@example.com>`,
        `CC: Casey Quinn <casey.quinn@example.com>`,
        `Subject: ${subject}`,
        `Date: ${new Date(item.modifiedAt ?? Date.now()).toUTCString()}`,
        `Content-Type: text/plain; charset=UTF-8`,
        ``,
        `Hi Brett,`,
        ``,
        `This is a demo email stored in the file manager. In production this would be`,
        `the actual content of ${item.name}.`,
        ``,
        `Please review the attached items and let me know if you have any questions.`,
        ``,
        `Best regards,`,
        `Alice`,
      ].join('\r\n');
      return of(emlContent).pipe(delay(60));
    }

    if (ext === 'csv') {
      return of('name,value,date\nAlpha,123,2026-01-01\nBeta,456,2026-02-01\nGamma,789,2026-03-01\nDelta,321,2026-04-01').pipe(delay(60));
    }

    if (ext === 'md') {
      return of(`# ${item.name.replace(/\.md$/i, '')}\n\nDemo markdown content for this file.\n\n- Item one\n- Item two\n- Item three`).pipe(delay(60));
    }

    if (ext === 'txt' || ext === 'log') {
      return of(`[INFO]  Application started\n[INFO]  Loading configuration\n[WARN]  Config value "timeout" not set, using default 30s\n[INFO]  Connected to database\n[INFO]  Ready`).pipe(delay(60));
    }

    return of(`Preview not available for ${item.name}`).pipe(delay(30));
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
      const uploadId = `wcfm-mock-upload-${specIndex}`;

      return concat(
        of(this.progress(displayName, 10, 'uploading', uploadId, file.size)),
        of(this.progress(displayName, 65, 'uploading', uploadId, file.size)).pipe(delay(120)),
        of(this.progress(displayName, 100, 'completed', uploadId, file.size)).pipe(
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

            const finalPath = `${normalizePath(parentPath)}/${resolved.finalName}`.replace(/\/+/g, '/');
            this.uploadedFiles.set(finalPath, file);

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
    const content = `Downloaded from demo provider: ${item.path}`;
    return of(new Blob([content], { type: 'text/plain' })).pipe(delay(40));
  }

  rename(item: WhitecapFileItem, newName: string): Observable<WhitecapOperationResult<WhitecapFileItem>> {
    this.replaceItem(item, { ...item, name: newName, path: `${item.parentPath ?? ''}/${newName}`.replace(/\/+/g, '/') });
    return of({ data: { ...item, name: newName } }).pipe(delay(80));
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
      return ((new Date(a.modifiedAt ?? 0).valueOf() - new Date(b.modifiedAt ?? 0).valueOf()) * multiplier);
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

  private file(name: string, parentPath: string, size = Math.floor(5_000 + Math.random() * 100_000)): WhitecapFileItem {
    const owner = this.owners[Math.floor(Math.random() * this.owners.length)];
    const daysAgo = Math.floor(Math.random() * 365);
    const modified = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    return {
      id: crypto.randomUUID(),
      name,
      parentPath: normalizePath(parentPath),
      path: `${normalizePath(parentPath)}/${name}`.replace(/\/+/g, '/'),
      type: 'file',
      size,
      owner,
      modifiedAt: modified,
      createdAt: modified,
      extension: name.includes('.') ? name.split('.').at(-1) : undefined,
      mimeType: 'application/octet-stream',
    };
  }

  private folder(name: string, parentPath: string): WhitecapFileItem {
    const owner = this.owners[Math.floor(Math.random() * this.owners.length)];
    return {
      id: crypto.randomUUID(),
      name,
      parentPath: normalizePath(parentPath),
      path: `${normalizePath(parentPath)}/${name}`.replace(/\/+/g, '/'),
      type: 'folder',
      hasChildren: true,
      owner,
      modifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  private progress(
    fileName: string,
    percent: number,
    status: WhitecapUploadProgress['status'],
    uploadId: string,
    fileSize: number,
  ): WhitecapUploadProgress {
    return {
      fileName,
      uploadId,
      loaded: Math.round((percent / 100) * fileSize),
      total: fileSize,
      percent,
      status,
    };
  }

  /** All files in the subtree rooted at `rootPath` (recursive); excludes folders. */
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
      return { parentPath: uploadRoot, leafName: segments[0] };
    }
    const dirPortion = segments.slice(0, -1).join('/');
    const parentPath = this.ensureFolderChain(uploadRoot, dirPortion);
    const leafName = segments[segments.length - 1]!;
    return { parentPath, leafName };
  }

  /** Creates each folder segment under basePath; returns the path of the deepest folder. */
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
