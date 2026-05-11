# Whitecap File Manager — Pending Features

## Item 1 — Keyboard shortcuts

Add `HostListener` bindings to the component for common file manager keyboard actions:

- `Delete` → trigger delete dialog (when items are selected)
- `F2` → trigger rename dialog (when exactly one item is selected)
- `Enter` → open the focused/selected item (navigate into folder or emit `fileOpened`)
- `Ctrl+C` → copy selected items to internal clipboard
- `Ctrl+X` → cut selected items to internal clipboard
- `Ctrl+V` → paste clipboard items into the current folder (calls `store.copySelected` or `store.moveSelected`)

**Notes:**
- Clipboard state can be a local signal: `clipboardItems` + `clipboardMode: 'copy' | 'cut'`
- Scope shortcuts to the host element so they don't fire when focus is inside an input/dialog
- Guards: only fire when no dialog/context menu is open

---

## Item 2 — `fileCreated` output event

Add `@Output() readonly fileCreated = new EventEmitter<WhitecapFileItem>();` to the component.

Emit from `confirmDialog()` after successful folder creation:

```ts
this.store.createFolder(this.dialogValue().trim(), (result) => {
  if (result.data) {
    this.fileCreated.emit(result.data);
  }
});
```

**Files to change:** `whitecap-file-manager.ts`

---

## Item 3 — `selectionChanged` on right-click

Verify that right-clicking an unselected item replaces the selection with that item before the context menu opens. Current code in `onItemContextMenu` already does this — confirm it also fires the `selectionChanged` output correctly (it flows through the `effect` on `store.selectedItems()` so it should be fine).

**Files to check:** `whitecap-file-manager.ts` — `onItemContextMenu`, the `selectionChanged` effect in constructor.

---

## Item 4 — `defaultPageSize` input

Expose `store.pageSize` as a component input so consumers can set it declaratively:

```ts
readonly defaultPageSize = input<number>(50);
```

Wire it in the constructor effect (alongside `defaultDuplicateStrategy`):

```ts
effect(() => {
  this.store.setPageSize(this.defaultPageSize());
});
```

**Files to change:** `whitecap-file-manager.ts`

---

## Item 6 — `visibleFileTypes` input

Add an input that transparently restricts which file types appear in the grid, without requiring the user to open the filter panel:

```ts
readonly visibleFileTypes = input<string[] | null>(null);
```

In `FileManagerStore.refresh()` (or via a computed query override), merge `visibleFileTypes` into `query.filters.fileTypes` before calling `provider.list()`. Consumer-level visible types should be ANDed with any active user filter.

**Files to change:** `whitecap-file-manager.ts`, possibly `file-manager.store.ts`
