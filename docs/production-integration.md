# Integrating Whitecap File Manager in a production app

This guide explains how to embed `whitecap-file-manager` in a real Angular application: wiring the component, implementing storage against your API, mapping backend models to `WhitecapFileItem`, and how list/tree refresh works after mutations.

It also documents **[all built-in features](#9-feature-catalog-and-customization)** and **[how to configure them](#91-configuration-summary)**.

## Architecture

The file manager is a **standalone Angular component** (`WhitecapFileManagerComponent`) with an internal **`FileManagerStore`** (signals). All server or enterprise storage access goes through a **`WhitecapStorageProvider`** you implement. The UI navigates by **POSIX-style paths** (for example `/Billing`, `/Quotes/6`); your provider translates those paths to API calls (or resolves them to drive item IDs using `item.id` and `item.metadata`).

You do **not** pass a full file tree into the component. You pass a **provider instance**; the component calls `list`, `tree`, `upload`, `rename`, and so on as needed.

## 1. Add the library to your app

**From this monorepo (local development):**

1. Build the library: `ng build whitecap-file-manager`
2. In your app's `tsconfig.json` (or path mapping), point `whitecap-file-manager` at `dist/whitecap-file-manager` (same pattern as the `demo` project), or publish/install the package from your registry.

**From npm (after publish):**

Install the package name your team publishes, then import symbols from `whitecap-file-manager`.

Public exports include:

- `WhitecapFileManagerComponent`
- Types and interfaces in `./models` (for example `WhitecapStorageProvider`, `WhitecapFileItem`, `WhitecapFileQuery`)
- `DEFAULT_TOOLBAR_ACTIONS`, `WhitecapToolbarAction`
- `WcfmTileItemDirective`, `WcfmPreviewDirective` — content-projection directives for custom grid tiles and preview pane
- `WHITECAP_STORAGE_PROVIDER` (optional `InjectionToken` if you prefer token-based injection over an input; the demo binds `[provider]` directly)

## 2. Declare the component and a provider

```typescript
// feature.component.ts
import { Component, inject } from '@angular/core';
import { WhitecapFileManagerComponent } from 'whitecap-file-manager';
import { WorkOrderStorageProvider } from './work-order-storage.provider';

@Component({
  selector: 'app-files',
  imports: [WhitecapFileManagerComponent],
  template: `
    <whitecap-file-manager
      [provider]="storage"
      [height]="'min(42rem, 85vh)'"
      [uploadValidation]="uploadRules"
      [defaultDuplicateStrategy]="'rename'"
      (folderChanged)="onFolder($event)"
      (fileOpened)="onOpen($event)"
    />
  `,
})
export class FilesFeatureComponent {
  protected readonly storage = inject(WorkOrderStorageProvider);
  protected readonly uploadRules = {
    maxFileSizeBytes: 20 * 1024 * 1024,
    acceptedExtensions: ['.pdf', '.docx', '.png'],
  };

  onFolder(path: string): void {
    // optional: sync route query param, analytics, etc.
  }

  onOpen(item: import('whitecap-file-manager').WhitecapFileItem): void {
    // optional: navigate to viewer, open webUrl from item.downloadUrl / item.metadata
  }
}
```

## 3. Component API (inputs and outputs)

### Inputs (signal-based)

| Input | Purpose |
|--------|--------|
| `provider` | **`WhitecapStorageProvider`** (required for meaningful behavior). |
| `initialPath` | Starting folder path (default `'/'`). |
| `actions` | Toolbar buttons; default is `DEFAULT_TOOLBAR_ACTIONS`. |
| `enableFolderUpload` | Toggle folder upload control (default `true`). |
| `uploadValidation` | `WhitecapUploadValidationConfig` (size, extensions, custom validator). |
| `defaultDuplicateStrategy` | `'ask' \| 'replace' \| 'rename' \| 'skip'` for uploads. |
| `defaultPageSize` | Initial page size (default `50`). |
| `visibleFileTypes` | `string[] \| null` — component-level file extension restriction, ANDed with any active filter. Pass `null` to show all types. |
| `previewPaneVisible` | Sets the **initial** visibility of the preview pane (default `false`). The user can toggle it via the Preview toolbar button. |
| `height` | CSS length for the shell (e.g. `'600px'`, `'min(70vh, 48rem)'`). Recommended so inner panes scroll correctly. |

### Outputs

| Output | Payload | When it fires |
|--------|---------|----------------|
| `folderChanged` | `string` (path) | Current folder path changed (breadcrumb, tree, double-click folder, after some navigations). Emits the **normalized path** string. |
| `fileOpened` | `WhitecapFileItem` | User opened a **file** (double-click / Enter / context "Open"). Folders navigate internally and do not emit this. |
| `selectionChanged` | `WhitecapFileItem[]` | Selected rows changed (reactive `effect`; emits current selection). |
| `fileCreated` | `WhitecapFileItem` | After a folder is successfully created via "New Folder"; emits `result.data`. |
| `uploadStarted` | `number` (file count) | Count of files accepted after client-side validation, right before upload starts. |
| `uploadCompleted` / `uploadFailed` | `WhitecapUploadProgress` | Per-file terminal `WhitecapUploadProgress` from the provider stream. |
| `fileDeleted` | `string[]` (item ids) | After a successful delete: emits **`string[]`** of deleted item **`id`**s (captured before the operation). |
| `fileRenamed` | `WhitecapFileItem` | After a successful rename: emits **`WhitecapFileItem`** from `result.data` when present. |
| `fileMoved` / `fileCopied` | `string` (target path) | After a successful move/copy: emits the **destination folder path** string (`targetPath`). |
| `actionTriggered` | `WhitecapActionTriggeredEvent` | A custom (non-built-in) toolbar or context-menu action was invoked. Payload: `{ actionId: string, items: WhitecapFileItem[] }`. |

Use these to sync routing, open your document viewer, log analytics, or handle custom toolbar actions without forking the library.

### Manual refresh from the host

After mutations that **do not** go through the provider (rare), or when external data changes:

- Users can use the built-in **Refresh** toolbar action.
- Or obtain a reference to `WhitecapFileManagerComponent` and call **`component.store.hardRefresh()`** — this calls `provider.refresh()` (if implemented) then re-runs `list` and the tree. Use **`component.store.refresh()`** to skip the server-side cache-bust step.

## 4. Implement `WhitecapStorageProvider`

Your class must satisfy the interface in `models.ts`: at minimum **`list`**, **`createFolder`**, **`upload`**, **`download`**, **`rename`**, **`delete`**, **`move`**, **`copy`**. Optional: **`tree`**, **`preview`**, **`refresh`**, and **`capabilities`**.

Recommended **`capabilities`**:

```typescript
readonly capabilities = {
  supportsTree: true,
  supportsFolderUpload: true,
  supportsPagination: true, // optional hint only; the component does not branch on this flag today
  supportsPreview: true, // optional hint; preview runs if you implement preview()
};
```

If `supportsTree` is false or `tree` is omitted, the tree panel falls back to an empty/error state according to the store.

### `list(query: WhitecapFileQuery)`

The store calls this whenever the current folder, sort, search, filters, pagination, or "flat files" mode changes, and after successful mutations.

- Honor **`query.path`** (normalized with a leading `/`).
- Honor **`query.flatFiles`**: when true, return a **flat list of files only** under the root path given (see interface on `WhitecapFileQuery`).
- Return **`WhitecapFilePage`**: `{ items, total? }`. Provide **`total`** when you paginate on the server.

### `tree(path?: string)`

Return an observable of **folder-only** `WhitecapFileItem[]` representing the folder hierarchy the tree should know about (the component filters to `type === 'folder'`). The store requests `tree('/')` when refreshing the tree. Implement this by walking cached data or calling a "list folders" API.

### `refresh()` (optional)

If implemented, the Refresh toolbar button calls `provider.refresh()` first, then calls `list` again. Use this to invalidate a server-side cache or force a fresh fetch. If not implemented, the toolbar Refresh still works — it just calls `list` directly.

### Mutations (`rename`, `delete`, `move`, `copy`, `createFolder`, `upload`)

Each should return **`Observable<WhitecapOperationResult<T>>`** (or `Observable<WhitecapUploadProgress>` for uploads with many emissions).

- On **success**, emit an object **without** `error` (you may include `data`).
- On **failure**, emit `{ error: { code, message, retryable?, details? } }`.

The internal store, on success, **automatically calls `refresh()`** (and related tree refresh) so the UI matches the server. You normally **do not** need to push updated arrays from the parent.

### `upload`

Emit progress objects with `status: 'pending' | 'uploading' | 'completed' | 'failed'`. The store runs a **full `refresh()`** each time a row reaches **`completed`** (large batches may refresh multiple times).

### `download` / optional `preview`

Return `Observable<Blob>` (or `Blob | string` for preview). Use `item.id` and `item.metadata` from your mapping layer to call the correct API.

## 5. Map your API to `WhitecapFileItem`

The UI is path-centric. Typical mapping from a nested or Graph-style payload:

| Your API | `WhitecapFileItem` |
|----------|-------------------|
| Stable drive/item id | `id` |
| Display name | `name` |
| Synthetic full path | `path` (e.g. `/Quotes/6/Addendums`) |
| Parent path | `parentPath` (e.g. `/Quotes/6`) |
| Folder vs file | `type`: `'folder'` \| `'file'` |
| Size, timestamps | `size`, `modifiedAt`, `createdAt` |
| File name extension | `extension` (helps icons and filters) |
| Open in browser / download | `downloadUrl` or URLs inside `metadata` |
| Everything else (driveId, siteId, listId, listItemId, custom flags) | `metadata: Record<string, unknown>` |
| Per-item action restrictions | `permissions: { canRename?, canDelete?, canMove?, canDownload? }` |

Keep **IDs and Graph parameters in `metadata`** so renames on the server do not break lookups when paths change.

Set `permissions` to `false` for any action the user should not be able to perform on a specific item. Undefined (omitted) means allowed.

Reference implementation in this repo: `projects/demo/src/app/production-like-mock-storage-provider.ts` and `work-order-mock-tree.json` (SharePoint-shaped tree mapped to `WhitecapFileItem`).

## 6. HTTP and RxJS patterns

Use `HttpClient` and return Observables that **complete** after the operation:

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import type { WhitecapFileItem, WhitecapOperationResult, WhitecapStorageProvider } from 'whitecap-file-manager';

@Injectable()
export class ApiStorageProvider implements WhitecapStorageProvider {
  private readonly http = inject(HttpClient);

  rename(item: WhitecapFileItem, newName: string): Observable<WhitecapOperationResult<WhitecapFileItem>> {
    return this.http.patch<{ id: string; name: string }>(`/api/files/${item.id}`, { name: newName }).pipe(
      map(() => ({
        data: {
          ...item,
          name: newName,
          path: `${item.parentPath ?? '/'}/${newName}`.replace(/\/+/g, '/'),
        },
      })),
      catchError((err) =>
        of({
          error: {
            code: 'rename_failed',
            message: err?.error?.message ?? 'Rename failed',
          },
        }),
      ),
    );
  }
}
```

After this emits a successful result, the file manager **refetches** the current directory via **`list`**, so your `list` implementation should read **fresh** data (or invalidate cache before resolving).

## 7. Authentication and errors

- Attach interceptors (bearer tokens, site headers) at the app level; the provider only calls `HttpClient`.
- Map HTTP 4xx/5xx to `WhitecapOperationError` so the store can show toasts.
- For `list` failures, the store sets an error state on the main pane; implement **`tree`** error handling similarly if your tree endpoint can fail independently.

## 8. Checklist before go-live

- [ ] `list` returns correct children for every navigable `path` and respects pagination/sort/search when you use those features.
- [ ] `tree` stays consistent with `list` for folder names and paths.
- [ ] Mutations return `WhitecapOperationResult` without `error` only when the server succeeded; then verify UI updates without a manual refresh.
- [ ] Upload progress reaches `completed` (or `failed`) for every file in a batch.
- [ ] `download` (and `preview` if used) enforce auth the same way as the rest of your app.
- [ ] `height` is set so the explorer scrolls inside a predictable viewport.
- [ ] Toolbar actions match what your backend supports (you can pass a reduced `actions` array).
- [ ] Per-item `permissions` are populated if your backend has item-level ACLs.

## 9. Feature catalog and customization

### 9.1 Configuration summary

| What you want | How to configure |
|----------------|------------------|
| Which toolbar buttons exist | Pass **`[actions]`** with a subset or superset of `WhitecapToolbarAction` (`id`, `label`, optional `icon`, optional `requiresSelection`). Default: **`DEFAULT_TOOLBAR_ACTIONS`** from `default-toolbar-actions.ts`. Known **`id`** values handled by the component: `refresh`, `new-folder`, `upload`, `move`, `copy`, `rename`, `delete`, `download`. Other ids render as buttons and emit **`actionTriggered`**. |
| Disable a custom button when nothing is selected | Set **`requiresSelection: true`** on the `WhitecapToolbarAction`. |
| Custom action handler | Listen to **`(actionTriggered)`** — fires with `{ actionId, items }` for any id not handled internally. |
| Starting folder | **`[initialPath]`** (e.g. `'/Billing'`). When the **`provider` instance** changes, the store rebinds and applies `initialPath` again. |
| Explorer height / scrolling | **`[height]`** — any CSS length; sets host layout so inner areas scroll. |
| Client-side upload rules | **`[uploadValidation]`** — `maxFileSizeBytes`, `acceptedMimeTypes`, `acceptedExtensions`, optional **`validator(file)`** returning an error or `null`. Rejected files appear in an inline **validation banner**; accepted files still upload. |
| Default duplicate handling for uploads | **`[defaultDuplicateStrategy]`** — `'replace' \| 'rename' \| 'skip'` applies directly. **`'ask'`** uses a **`window.prompt`** in the component to choose `replace`, `rename`, or `skip` per batch step (coarse UX; replace with a fixed strategy in production if you dislike prompts). |
| Initial page size | **`[defaultPageSize]`** (default `50`). Users can change it at runtime via the page-size selector. |
| Restrict visible file types | **`[visibleFileTypes]`** — array of extensions (e.g. `['.pdf', '.docx']`); ANDed with any active filter panel selection. Pass `null` (or omit) to show all types. |
| Hide folder upload | **`[enableFolderUpload]="false"`** — removes the "Upload Folders" control. Also respect **`capabilities.supportsFolderUpload`** on the provider (`false` disables even if `enableFolderUpload` is true). |
| Preview pane initial state | **`[previewPaneVisible]="true"`** opens the pane on load. The user can toggle it via the Preview toolbar button at any time. Preview only works if the provider implements **`preview()`**, unless you supply a `[wcfmPreview]` custom template. |
| Provider-driven capability flags | Set **`WhitecapStorageProvider.capabilities`**: **`supportsTree`** (omit `tree()` to leave tree empty), **`supportsFolderUpload`**, **`supportsPreview`** (informational; preview runs if `preview` exists). **`supportsPagination`** exists on the type but is **not read** by the component today—pagination UI always uses `list` + `total`. |
| Per-item action restrictions | Set **`permissions`** on `WhitecapFileItem`: `canRename`, `canDelete`, `canMove`, `canDownload`. `false` disables; `undefined` means allowed. |
| Custom grid tile rendering | Project **`<ng-template wcfmTileItem let-item let-selected="selected">`** as a content child. |
| Custom preview pane content | Project **`<ng-template wcfmPreview let-item let-loading="loading">`** as a content child. |

### 9.2 Toolbar and built-in actions

Default order in `DEFAULT_TOOLBAR_ACTIONS`:

1. **Refresh** — calls `store.hardRefresh()` (calls `provider.refresh()` if available, then reloads `list` + tree).
2. **New Folder** — dialog; calls `createFolder(currentPath, name)`. Emits **`fileCreated`** with the returned item.
3. **Upload Files** — file input; supports multi-file. **Upload Folders** appears next when folder upload is allowed (webkitdirectory).
4. **Move / Copy / Rename / Delete** — selection-based; rename requires exactly one selected row (`isActionDisabled` logic). Actions are also disabled per-item when `permissions` denies them.
5. **Download** — calls `download()` on each selected **file**.

Custom actions not matching a built-in id render as buttons and emit **`actionTriggered`** when clicked. Set `requiresSelection: true` to auto-disable them when nothing is selected.

> **Flat-files mode restriction:** When "Show All Files" is active, the toolbar narrows to only `refresh`, `rename`, `delete`, and `download` from the `[actions]` input.

### 9.3 Navigation and layout

| Feature | Behavior | Customize |
|---------|----------|-----------|
| **Breadcrumbs** | "Root" plus path segments; clicking sets path. Drop target for drag-move. Shows total item count. | Labels are path segments; "Root" label is not i18n-configurable without forking. |
| **Folder tree** | Left pane; expand/collapse; shows **child counts** when `childCount` is set on items from `tree()`. Resizable via **splitter** (drag). | Hide indirectly by omitting `tree()` / `supportsTree: false` (tree shows empty/error). Width is user-resized (not an input). |
| **Main list** | Table: columns Name, Modified, Modified By, Size; column headers sort by **name**, **modifiedAt**, and **size** (`WhitecapSortField`). | Row content comes entirely from `WhitecapFileItem`; **`owner`** column shows `item.owner ?? '—'`. There is **no "sort by type"** column control (grid/list still receive `type` on items for icons). |
| **Grid view** | Large icons; folder vs file icons. | Toggle with list/grid buttons (hidden in flat-files mode for grid-specific behavior—entering grid turns off flat mode in store). Fully replaceable via `[wcfmTileItem]` content projection. |
| **Pagination** | Footer: first/prev/next/last, page indicator, **page size** select **10, 25, 50, 100** (fixed set in component). Initial size set by `[defaultPageSize]`. | Your `list` must honor `query.pagination` and return **`total`** for correct page count. |

### 9.4 Search, filters, and flat file list

| Feature | Behavior | Customize |
|---------|----------|-----------|
| **Search** | Toolbar search box; debounced/live `store.setSearch` → **`list`** with `query.search`. In **flat files** mode, placeholder indicates searching under root. | No separate input API; host cannot change debounce without forking. |
| **Filters** | Panel fields: **file types** (comma/space separated extensions), **owner** string, **date from/to** (HTML date inputs). **Apply** → `store.setFilters` → **`list`**. | The filter **panel is not opened by a default toolbar button** in the stock template. Open it by **`ViewChild(WhitecapFileManagerComponent)`** and call **`openFilterPanel()`**, or set filters from your own UI via **`component.store.setFilters(...)`** / **`clearFilters()`** (public store methods). Closed on Escape or background click. Disabled while **flat files** mode is on. |
| **Show All Files / Show Folders** | Toggles **`flatFilesMode`**: flat mode lists **all descendant files** from `/` with `query.flatFiles: true`, forces **list** view, resets path to `/`, and limits toolbar to Refresh / Rename / Delete / Download. | Provider must implement **`list`** with `flatFiles` semantics. |

### 9.5 Selection, context menu, dialogs

| Feature | Behavior |
|---------|----------|
| **Selection** | Checkbox per row; select-all; Ctrl/Cmd click patterns handled in component; **`selectionChanged`** output. |
| **Context menu** | Right-click row: **Open**, **Rename**, **Move**, **Copy**, **Download**, **Delete**, plus any custom actions from `[actions]` (non-toolbar-only ids). |
| **Dialogs** | New folder, rename, delete confirm, move/copy **folder picker** (tree with invalid targets disabled for folder-into-self). |

### 9.6 Drag and drop

| Feature | Behavior |
|---------|----------|
| **Internal drag** | Drag selected items onto a folder row, breadcrumb, or tree row to **move** (uses store move pipeline). |
| **External file drop** | Drop files/folders from OS onto the explorer shell or folder targets; builds `relativePath` for folder structures; same upload pipeline as file input. |

### 9.7 Upload panel and toasts

| Feature | Behavior |
|---------|----------|
| **Upload progress** | Floating panel: per-row progress; **Clear** removes completed/failed rows; **×** dismisses entire panel. |
| **Toasts** | Short success/error messages for operations (auto-dismiss ~4.5s per kind). |

### 9.8 Preview pane

Toggle visibility via the **Preview** toolbar button. The `[previewPaneVisible]` input sets the initial state. When open and the user selects a **single file**, the component calls **`provider.preview(item)`** if defined. Built-in rendering:

| Content type | Rendered as |
|---|---|
| `image/*` blob | `<img>` |
| `application/pdf` blob | `<iframe>` |
| `.eml` blob | Parsed headers + body |
| Text / string | `<pre>` |
| Other | Fallback message |

Supply a **`[wcfmPreview]`** content child template to replace all built-in rendering with your own. The template receives `{ $implicit: WhitecapFileItem, loading: boolean }`.

**`thumbnailUrl` on `WhitecapFileItem`** is not automatically used as the main preview image — preview is always driven by `preview()` or the custom template.

### 9.9 Content projection

#### Custom grid tile — `[wcfmTileItem]`

```html
<whitecap-file-manager [provider]="storage">
  <ng-template wcfmTileItem let-item let-selected="selected">
    <!-- your custom card markup -->
  </ng-template>
</whitecap-file-manager>
```

Context: `{ $implicit: WhitecapFileItem, selected: boolean }`.

#### Custom preview — `[wcfmPreview]`

```html
<whitecap-file-manager [provider]="storage">
  <ng-template wcfmPreview let-item let-loading="loading">
    <!-- your custom preview markup -->
  </ng-template>
</whitecap-file-manager>
```

Context: `{ $implicit: WhitecapFileItem, loading: boolean }`.

### 9.10 Keyboard and accessibility

- **Escape** closes context menu, dialogs, and filter panel.
- Skip link, ARIA labels on toolbar, tree, table, pagination, upload region (see template in `whitecap-file-manager.ts`).

### 9.11 Store-level hooks (advanced)

The **`FileManagerStore`** is constructed per component instance (`providers: [FileManagerStore]` on the selector). From a parent with `ViewChild` to `WhitecapFileManagerComponent`:

- **`component.store.setPath(path)`**, **`setSearch`**, **`setFilters`**, **`clearFilters`**, **`setPage`**, **`setPageSize`**, **`setViewMode`**, **`setFlatFilesMode`**, **`setVisibleFileTypes`** — programmatic control.
- **`component.store.refresh()`** — re-runs `list` + tree without calling `provider.refresh()`.
- **`component.store.hardRefresh()`** — calls `provider.refresh()` first (if defined), then `refresh()`. This is what the Refresh toolbar button calls.
- **`component.store.refreshTree()`** — reload the tree pane only.
- **`component.openFilterPanel()`** / **`component.togglePreviewPane()`** — UI panel control.

Do not replace the store in DI unless you know what you are doing—the template is tightly coupled to this store.

---

## 10. Related files in this repository

| Location | Role |
|----------|------|
| `projects/whitecap-file-manager/src/lib/models.ts` | Provider and item contracts |
| `projects/whitecap-file-manager/src/lib/file-manager.store.ts` | When `refresh()` and `hardRefresh()` run |
| `projects/whitecap-file-manager/src/lib/whitecap-file-manager.ts` | Component inputs/outputs/directives |
| `projects/whitecap-file-manager/src/lib/default-toolbar-actions.ts` | Default toolbar `id`s and labels |
| `projects/whitecap-file-manager/src/lib/tile-item.directive.ts` | `WcfmTileItemDirective` — custom grid tile projection |
| `projects/whitecap-file-manager/src/lib/preview.directive.ts` | `WcfmPreviewDirective` — custom preview pane projection |
| `projects/demo/src/app/` | Demo app: `ProductionLikeMockStorageProvider`, `MockStorageProvider` |

For deeper UI behavior, read `file-manager.store.ts` (`hardRefresh`, `refresh`, `refreshTree`, `uploadWithStrategy`, `runResultOperation`).
