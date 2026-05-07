# Whitecap File Manager — Feature Reference

`whitecap-file-manager` is a standalone Angular file manager component with adapter-driven backend integration. This document describes every built-in feature available to consumers.

---

## File and Folder Operations

| Operation | How it works |
|-----------|-------------|
| **Browse** | Navigate folders by double-clicking, clicking a breadcrumb segment, or clicking a tree node. |
| **Create folder** | Toolbar "New Folder" opens a name dialog and calls `provider.createFolder()`. |
| **Upload files** | Toolbar file input (multi-file). Accepted files go through the configured upload validation before upload starts. |
| **Upload folders** | Toolbar "Upload Folders" uses `webkitdirectory`; folder structure is preserved as nested paths. Disable via `[enableFolderUpload]="false"` or `capabilities.supportsFolderUpload: false`. |
| **Download** | Calls `provider.download()` for every selected file; toolbar and context menu. |
| **Rename** | Dialog; requires exactly one selected item; calls `provider.rename()`. |
| **Move** | Folder picker dialog; calls `provider.move()`; also triggered by internal drag-and-drop. |
| **Copy** | Folder picker dialog; calls `provider.copy()`. |
| **Delete** | Confirmation dialog; calls `provider.delete()` on all selected items. |

After every mutation the store automatically calls `list` (and `tree`) to keep the view in sync — no host-side refresh needed.

---

## Upload UX

- **Multi-file / multi-folder** support in one pick or drop operation.
- **Duplicate-name strategy** per upload batch: `ask` (prompt per conflict), `replace`, `rename` (auto-suffix), `skip`. Set the default via `[defaultDuplicateStrategy]`.
- **Client-side validation** via `[uploadValidation]`:
  - Max file size (`maxFileSizeBytes`)
  - Allowed MIME types (`acceptedMimeTypes`)
  - Allowed extensions (`acceptedExtensions`)
  - Custom per-file validator function returning an error string or `null`
  - Rejected files are shown in a validation banner; accepted files still proceed.
- **Progress panel** — floating overlay showing per-file progress bars, status (`pending | uploading | completed | failed`), and a Clear button. Dismissible with ×.

---

## Drag and Drop

- **Internal drag-move** — drag selected rows onto any folder row, breadcrumb segment, or tree node to move them.
- **External file drop** — drop files or folders from the OS onto the explorer shell or a folder target; feeds the same upload pipeline as the file picker.

---

## Navigation

- **Breadcrumbs** — clickable path segments; also a drop target for drag-move.
- **Folder tree** (left pane) — expand/collapse hierarchy; shows child counts when `childCount` is set by the provider. Resizable via a drag splitter. Requires `provider.tree()` and `capabilities.supportsTree: true`.
- **Refresh** — toolbar button reloads the current `list` and tree; also available programmatically via `component.store.refresh()`.

---

## Views and Layout

| Feature | Detail |
|---------|--------|
| **List view** | Table with columns: Name, Modified, Modified By, Size. Sortable by name, modified date, and size. |
| **Grid view** | Large file-type icons; sortable. Entering grid view exits flat-files mode. |
| **Flat files mode** | "Show All Files" toggle — lists every descendant file from root (`query.flatFiles: true`), forces list view, resets path to `/`. "Show Folders" reverts. |
| **Pagination** | Footer with first/prev/next/last controls, current-page indicator, and page-size selector (10, 25, 50, 100). Requires `provider.list()` to return `total` for correct page count. |
| **Height** | `[height]` input (any CSS length) controls the shell so inner panes scroll correctly. |

---

## Search and Filters

- **Search** — debounced search box in the toolbar; passes `query.search` to `provider.list()`. In flat-files mode the placeholder indicates root scope.
- **Filter panel** — hidden by default; open programmatically via `component.openFilterPanel()` or `component.store.setFilters()`. Fields:
  - File type extensions (comma or space separated)
  - Owner string
  - Date from / date to
  - "Apply" submits; "Clear" resets. Disabled while flat-files mode is on.

---

## Selection and Context Menu

- **Multi-select** — checkboxes per row, select-all header checkbox, Ctrl/Cmd click.
- **`selectionChanged` output** — emits the current `WhitecapFileItem[]` on every change.
- **Context menu** — right-click a row for: Open, Rename, Move, Copy, Download, Delete.

---

## Preview Pane

When `[previewPaneVisible]="true"` and exactly one file is selected, the component calls `provider.preview(item)`:

- **Image blobs** — rendered as `<img>`.
- **Text / string** — rendered as plain text.
- **Other blobs** — read as text.
- If `preview` is not implemented or returns an error, a fallback message is shown.

---

## Notifications

- **Toasts** — short success and error messages for every operation; auto-dismiss after ~4.5 s.
- **Confirmation dialogs** — shown before delete and other destructive operations.

---

## Keyboard and Accessibility

- **Escape** closes context menu, dialogs, and the filter panel.
- Skip link, ARIA labels on toolbar, tree, table, pagination, and upload drop region.

---

## Toolbar Customization

Pass `[actions]` to control which buttons appear. Each action has an `id`, `label`, and optional `icon`. The default set (in order) is:

| id | Label |
|----|-------|
| `refresh` | Refresh |
| `new-folder` | New Folder |
| `upload` | Upload Files / Upload Folders |
| `move` | Move |
| `copy` | Copy |
| `rename` | Rename |
| `delete` | Delete |
| `download` | Download |

Pass a reduced array to remove actions your backend does not support. Custom `id`s render as buttons but require forking the component to wire up behavior.

---

## Output Events

| Output | Payload | When |
|--------|---------|------|
| `folderChanged` | `string` (path) | Current folder path changes |
| `fileOpened` | `WhitecapFileItem` | User opens a file (double-click, Enter, or context "Open") |
| `selectionChanged` | `WhitecapFileItem[]` | Selected rows change |
| `uploadStarted` | `number` (file count) | Upload begins after validation |
| `uploadCompleted` | `WhitecapUploadProgress` | Per-file successful completion |
| `uploadFailed` | `WhitecapUploadProgress` | Per-file failure |
| `fileDeleted` | `string[]` (item ids) | After successful delete |
| `fileRenamed` | `WhitecapFileItem` | After successful rename |
| `fileMoved` | `string` (target path) | After successful move |
| `fileCopied` | `string` (target path) | After successful copy |

---

## Programmatic Control (Advanced)

Obtain a `ViewChild` reference to `WhitecapFileManagerComponent` and use the public `store`:

```typescript
component.store.setPath(path)
component.store.setSearch(term)
component.store.setFilters(filters)
component.store.setPage(index)
component.store.setPageSize(size)
component.store.setViewMode('list' | 'grid')
component.store.setFlatFilesMode(true | false)
component.store.refresh()
component.store.refreshTree()
component.openFilterPanel()
```

---

## Provider Capabilities

Set `capabilities` on your `WhitecapStorageProvider` to opt in or out of features:

| Flag | Effect |
|------|--------|
| `supportsTree` | Enables the folder tree pane (requires `tree()` method). |
| `supportsFolderUpload` | Enables the folder upload control (also gated by `[enableFolderUpload]`). |
| `supportsPreview` | Informational; preview runs when `preview()` is implemented. |
| `supportsPagination` | Informational; pagination UI is always present when `list` returns `total`. |
