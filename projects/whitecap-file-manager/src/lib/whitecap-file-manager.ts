import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Component,
  computed,
  contentChild,
  effect,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  Output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { catchError, EMPTY, finalize, map, Subject, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DEFAULT_TOOLBAR_ACTIONS } from './default-toolbar-actions';
import { BRAND_FILE_TYPE_SVGS } from './brand-file-type-svgs';
import { buildFileTypeIcons, FileIconKind, resolveFileIconKind } from './file-type-icons';
import { FileManagerStore, normalizePath, resolveFolderNavigatePath, WhitecapFilters } from './file-manager.store';
import {
  WhitecapDuplicateStrategy,
  WhitecapFileItem,
  WhitecapOperationError,
  WhitecapActionTriggeredEvent,
  WhitecapSortField,
  WhitecapStorageProvider,
  WhitecapToolbarAction,
  WhitecapUploadFileInput,
  WhitecapUploadFileSpec,
  WhitecapUploadValidationConfig,
  WhitecapUploadValidationIssue,
  WhitecapUploadProgress,
} from './models';
import { WcfmTileItemDirective } from './tile-item.directive';
import { WcfmPreviewDirective } from './preview.directive';

type ContextAction = string;

const TOOLBAR_ONLY_IDS = new Set(['refresh', 'new-folder', 'upload']);
type DialogAction = 'new-folder' | 'rename' | 'move' | 'copy' | 'delete' | null;

interface ContextMenuState {
  x: number;
  y: number;
  item: WhitecapFileItem;
}

interface TreeRow {
  item: WhitecapFileItem;
  depth: number;
  hasChildren: boolean;
  childCount: number;
  expanded: boolean;
}

const WCFM_DRAG_MIME = 'application/x-wcfm-items';

const WCFM_TREE_PANE_DEFAULT_PX = 240;
const WCFM_TREE_PANE_MIN_PX = 160;
const WCFM_TREE_PANE_MAX_PX = 560;
const WCFM_TREE_SPLITTER_TRACK_PX = 5;

/** When the filename has no extension, infer one from MIME for `acceptedExtensions` checks. */
const UPLOAD_MIME_TO_EXTENSION: Readonly<Record<string, string>> = {
  'application/csv': '.csv',
  'application/pdf': '.pdf',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/csv': '.csv',
  'text/markdown': '.md',
  'text/plain': '.txt',
  'text/x-markdown': '.md',
};

@Component({
  selector: 'whitecap-file-manager',
  imports: [CommonModule, FormsModule, WcfmTileItemDirective, WcfmPreviewDirective],
  providers: [FileManagerStore],
  host: {
    '[class.wcfm-fixed-height]': 'hasFixedHeight()',
    '[class.wcfm-is-resizing-tree]': 'treeSplitDragging()',
    '[style.height]': 'fixedHeightCss()',
  },
  template: `
    <section
      class="wcfm"
      [class.wcfm-external-drop-active]="externalFileDragOver()"
      (dragenter)="onExplorerDragEnter($event)"
      (dragleave)="onExplorerDragLeave($event)"
      (dragover)="onDragOver($event)"
      (drop)="onDrop($event)"
      (click)="onSurfaceClick()"
    >
      <a class="wcfm-skip" href="#wcfm-main">Skip to file list</a>

      <header class="wcfm-toolbar" role="toolbar" aria-label="File manager toolbar">
        <div class="wcfm-toolbar-left">
          @for (action of toolbarUploadSplit().before; track action.id) {
            <button
              type="button"
              class="wcfm-tbtn"
              [disabled]="isActionDisabled(action.id)"
              [attr.title]="action.label"
              (click)="executeToolbarAction(action.id)"
            >
              <span class="wcfm-icon" [innerHTML]="iconFor(action.id)" aria-hidden="true"></span>
              <span>{{ action.label }}</span>
            </button>
          }

          @if (toolbarUploadSplit().uploadAction; as uploadAction) {
            <div class="wcfm-toolbar-upload-group" role="group" aria-label="Upload">
              <button
                type="button"
                class="wcfm-tbtn"
                [disabled]="isActionDisabled(uploadAction.id)"
                [attr.title]="uploadAction.label"
                (click)="executeToolbarAction(uploadAction.id)"
              >
                <span class="wcfm-icon" [innerHTML]="iconFor(uploadAction.id)" aria-hidden="true"></span>
                <span>{{ uploadAction.label }}</span>
              </button>
              @if (!store.flatFilesMode() && supportsFolderUpload()) {
                <button type="button" class="wcfm-tbtn" (click)="triggerFolderUpload()" title="Upload folder">
                  <span class="wcfm-icon" [innerHTML]="icons.uploadFolder" aria-hidden="true"></span>
                  <span>Upload Folders</span>
                </button>
                <input
                  #folderUploadInput
                  class="wcfm-hidden"
                  type="file"
                  multiple
                  webkitdirectory
                  directory
                  [attr.webkitdirectory]="''"
                  [attr.directory]="''"
                  (change)="onUploadInput($event)"
                />
              }
            </div>
          }

          @for (action of toolbarUploadSplit().after; track action.id) {
            <button
              type="button"
              class="wcfm-tbtn"
              [disabled]="isActionDisabled(action.id)"
              [attr.title]="action.label"
              (click)="executeToolbarAction(action.id)"
            >
              <span class="wcfm-icon" [innerHTML]="iconFor(action.id)" aria-hidden="true"></span>
              <span>{{ action.label }}</span>
            </button>
          }

          <input #fileUploadInput class="wcfm-hidden" type="file" multiple (change)="onUploadInput($event)" />
        </div>

        <div class="wcfm-toolbar-right">
          <button
            type="button"
            class="wcfm-tbtn"
            [class.is-active]="store.flatFilesMode()"
            [attr.aria-pressed]="store.flatFilesMode()"
            [attr.title]="store.flatFilesMode() ? 'Return to folder list and tree' : 'List every file under the root folder in one table'"
            (click)="toggleFlatFilesMode()"
          >
            <span class="wcfm-icon" [innerHTML]="icons.flatFiles" aria-hidden="true"></span>
            @if (store.flatFilesMode()) {
              <span>Show Folders</span>
            } @else {
              <span>Show All Files</span>
            }
          </button>

          <button
            type="button"
            class="wcfm-tbtn"
            [class.is-active]="previewPaneOpen()"
            [attr.aria-pressed]="previewPaneOpen()"
            [attr.title]="previewPaneOpen() ? 'Hide preview pane' : 'Show preview pane'"
            (click)="togglePreviewPane()"
          >
            <span class="wcfm-icon" [innerHTML]="icons.previewPane" aria-hidden="true"></span>
            @if (previewPaneOpen()) {
              <span>Hide Preview</span>
            } @else {
              <span>Preview</span>
            }
          </button>

          @if (!store.flatFilesMode()) {
            <div class="wcfm-viewgroup" role="group" aria-label="View mode">
              <button
                type="button"
                class="wcfm-vbtn"
                [class.is-active]="store.viewMode() === 'list'"
                title="Details view"
                aria-label="Details view"
                (click)="store.setViewMode('list')"
              >
                <span class="wcfm-icon" [innerHTML]="icons.list" aria-hidden="true"></span>
              </button>
              <button
                type="button"
                class="wcfm-vbtn"
                [class.is-active]="store.viewMode() === 'grid'"
                title="Large icons"
                aria-label="Large icons view"
                (click)="store.setViewMode('grid')"
              >
                <span class="wcfm-icon" [innerHTML]="icons.grid" aria-hidden="true"></span>
              </button>
            </div>
          }

          <div class="wcfm-search">
            <span class="wcfm-icon wcfm-search-icon" [innerHTML]="icons.search" aria-hidden="true"></span>
            <input
              type="search"
              [attr.aria-label]="store.flatFilesMode() ? 'Search files under root' : 'Search current path'"
              name="search"
              autocomplete="off"
              placeholder="Search…"
              [value]="store.search()"
              (input)="onSearchInput($event)"
            />
          </div>
        </div>
      </header>

      <nav class="wcfm-crumbs" aria-label="Breadcrumb">
        @for (crumb of store.breadcrumbs(); track crumb.path; let last = $last) {
          <button
            type="button"
            class="wcfm-crumb"
            [class.is-current]="crumb.path === store.currentPath()"
            [class.is-drop-target]="dropTargetPath() === crumb.path"
            (click)="store.setPath(crumb.path)"
            (dragover)="onFolderDragOver(crumb.path, $event)"
            (dragleave)="onFolderDragLeave(crumb.path)"
            (drop)="onFolderDrop(crumb.path, $event)"
          >
            {{ crumb.label }}
          </button>
          @if (!last) {
            <span class="wcfm-crumb-sep" aria-hidden="true">›</span>
          }
        }
        <span class="wcfm-crumb-count" aria-hidden="true">
          @if (store.flatFilesMode()) {
            · {{ store.total() }} file{{ store.total() === 1 ? '' : 's' }} (flat)
          } @else {
            · {{ store.total() }} item{{ store.total() === 1 ? '' : 's' }}
          }
        </span>
      </nav>

      @if (validationIssues().length) {
        <section
          class="wcfm-validation-banner"
          role="region"
          aria-labelledby="wcfm-validation-heading"
          aria-live="polite"
        >
          <div class="wcfm-validation-banner-head">
            <h2 id="wcfm-validation-heading" class="wcfm-validation-heading">Some files were not added</h2>
            <button
              type="button"
              class="wcfm-validation-dismiss"
              aria-label="Dismiss upload warnings"
              (click)="clearValidationIssues()"
            >
              Dismiss
            </button>
          </div>
          <ul class="wcfm-validation-list">
            @for (issue of validationIssues(); track issue.fileName + issue.error.code) {
              <li class="wcfm-validation-item">
                <span class="wcfm-validation-file-wrap" translate="no">
                  <code class="wcfm-validation-file">{{ issue.fileName }}</code>
                </span>
                <span class="wcfm-validation-msg">{{ issue.error.message }}</span>
              </li>
            }
          </ul>
        </section>
      }

      @if (filterOpen() && !store.flatFilesMode()) {
        <section class="wcfm-filter-panel" role="region" aria-label="Filters" (click)="$event.stopPropagation()">
          <div class="wcfm-filter-row">
            <label class="wcfm-filter-field">
              <span>File types</span>
              <input
                type="text"
                placeholder="pdf, csv, png…"
                [value]="filterDraft().fileTypes ?? ''"
                (input)="onFilterDraftChange('fileTypes', $event)"
              />
            </label>
            <label class="wcfm-filter-field">
              <span>Owner</span>
              <input
                type="text"
                placeholder="e.g. Alice Tan"
                [value]="filterDraft().owner ?? ''"
                (input)="onFilterDraftChange('owner', $event)"
              />
            </label>
            <label class="wcfm-filter-field">
              <span>From</span>
              <input
                type="date"
                [value]="filterDraft().dateFrom ?? ''"
                (input)="onFilterDraftChange('dateFrom', $event)"
              />
            </label>
            <label class="wcfm-filter-field">
              <span>To</span>
              <input
                type="date"
                [value]="filterDraft().dateTo ?? ''"
                (input)="onFilterDraftChange('dateTo', $event)"
              />
            </label>
          </div>
          <div class="wcfm-filter-actions">
            <button type="button" class="wcfm-btn" (click)="clearFilters()">Clear</button>
            <button type="button" class="wcfm-btn is-primary" (click)="applyFilters()">Apply</button>
          </div>
        </section>
      }

      <div
        class="wcfm-body"
        [class.has-preview]="showPreview()"
        [class.wcfm-body-flat]="store.flatFilesMode()"
        [style.--wcfm-tree-pane]="store.flatFilesMode() ? null : treePaneWidthPx() + 'px'"
      >
        @if (store.toasts().length) {
          <div class="wcfm-toast-stack" role="region" aria-label="Notifications" aria-live="polite">
            @for (toast of store.toasts(); track toast.kind) {
              <div class="wcfm-toast" [class.is-error]="toast.variant === 'error'">
                <span class="wcfm-icon wcfm-toast-icon" [innerHTML]="toast.variant === 'error' ? icons.toastError : icons.toastSuccess" aria-hidden="true"></span>
                <span>{{ toast.message }}</span>
              </div>
            }
          </div>
        }
        @if (!store.flatFilesMode()) {
        <aside
          class="wcfm-tree"
          aria-label="Folder tree"
          [attr.aria-busy]="store.treeLoading() && store.treeItems().length > 0 ? 'true' : null"
        >
          <div
            class="wcfm-tree-stack"
            [class.is-refreshing]="store.treeLoading() && store.treeItems().length > 0"
          >
          @if (store.treeLoading() && !store.treeItems().length) {
            <ul class="wcfm-tree-list" aria-hidden="true">
              @for (_ of treeSkeletonRows; track $index) {
                <li class="wcfm-tree-skel"></li>
              }
            </ul>
          } @else if (store.treeError()) {
            <p class="wcfm-state wcfm-error">{{ store.treeError()?.message }}</p>
          } @else if (!treeRows().length) {
            <p class="wcfm-state">No folders.</p>
          } @else {
            <ul class="wcfm-tree-list">
              @for (row of treeRows(); track row.item.path) {
                <li>
                  <div
                    class="wcfm-tree-row"
                    [class.is-active]="row.item.path === store.currentPath()"
                    [class.is-drop-target]="dropTargetPath() === row.item.path"
                    [style.padding-left.px]="row.depth * 14 + 4"
                    (dragover)="onFolderDragOver(row.item.path, $event)"
                    (dragleave)="onFolderDragLeave(row.item.path)"
                    (drop)="onFolderDrop(row.item.path, $event)"
                  >
                    <button
                      type="button"
                      class="wcfm-tree-toggle"
                      [disabled]="!row.hasChildren"
                      [attr.aria-label]="row.expanded ? 'Collapse folder' : 'Expand folder'"
                      (click)="toggleTreeFolder(row.item.path)"
                    >
                      @if (row.hasChildren) {
                        <span class="wcfm-icon" [innerHTML]="row.expanded ? icons.chevDown : icons.chevRight" aria-hidden="true"></span>
                      } @else {
                        <span class="wcfm-icon"></span>
                      }
                    </button>
                    <button type="button" class="wcfm-tree-label" (click)="openTreePath(row.item.path)">
                      <span class="wcfm-icon wcfm-folder-icon" [innerHTML]="icons.folderBrand" aria-hidden="true"></span>
                      <span class="wcfm-tree-name">{{ row.item.name }}</span>
                    </button>
                    <span class="wcfm-tree-count">{{ row.childCount }}</span>
                  </div>
                </li>
              }
            </ul>
          }
          @if (store.treeLoading() && store.treeItems().length > 0) {
            <div class="wcfm-refresh-overlay wcfm-tree-refresh-overlay" aria-hidden="true">
              <span class="wcfm-refresh-spinner"></span>
            </div>
          }
          </div>
        </aside>
        <div
          class="wcfm-tree-splitter"
          role="separator"
          aria-orientation="vertical"
          [attr.aria-valuenow]="treePaneWidthPx()"
          [attr.aria-valuemin]="treePaneMinPx"
          [attr.aria-valuemax]="treePaneMaxPx"
          tabindex="0"
          title="Drag to resize folder tree"
          (pointerdown)="onTreeSplitterPointerDown($event)"
          (keydown)="onTreeSplitterKeydown($event)"
        ></div>
        }

        <main class="wcfm-main" id="wcfm-main" [class.has-preview]="showPreview()">
          <div
            class="wcfm-main-scroll"
            [attr.aria-busy]="store.loading() && store.items().length > 0 ? 'true' : null"
          >
          <div
            class="wcfm-list-stack"
            [class.is-refreshing]="store.loading() && store.items().length > 0"
          >
          @if (store.loading() && !store.items().length) {
            @if (store.viewMode() === 'list' || store.flatFilesMode()) {
              <div class="wcfm-skeleton" aria-hidden="true">
                @for (_ of tableSkeletonRows; track $index) {
                  <div class="wcfm-skel-row"></div>
                }
              </div>
            } @else {
              <div class="wcfm-grid" aria-hidden="true">
                @for (_ of gridSkeletonCards; track $index) {
                  <div class="wcfm-skel-card"></div>
                }
              </div>
            }
          } @else if (store.error()) {
            <p class="wcfm-state wcfm-error">{{ store.error()?.message }}</p>
          } @else if (!store.items().length) {
            <section class="wcfm-empty">
              @if (store.flatFilesMode()) {
                <h3>No files here</h3>
                <p>There are no files in this folder or its subfolders. Try another folder or choose Show Folders.</p>
              } @else {
                <h3>This folder is empty</h3>
                <p>Drop files here or use the toolbar to upload.</p>
              }
            </section>
          } @else if (store.viewMode() === 'list' || store.flatFilesMode()) {
            <table class="wcfm-table" [class.wcfm-table-flat]="store.flatFilesMode()">
              <thead>
                <tr>
                  <th class="wcfm-col-check">
                    <label class="wcfm-check">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        [checked]="allSelected()"
                        [indeterminate]="someSelected()"
                        (change)="onSelectAllChange($event)"
                      />
                    </label>
                  </th>
                  <th class="wcfm-col-name">
                    <button type="button" class="wcfm-sortbtn" (click)="store.setSort('name')">
                      <span>Name</span>
                      <span class="wcfm-sort">{{ sortIndicator('name') }}</span>
                    </button>
                  </th>
                  @if (store.flatFilesMode()) {
                    <th class="wcfm-col-location"><span>Folder</span></th>
                  }
                  <th class="wcfm-col-modified">
                    <button type="button" class="wcfm-sortbtn" (click)="store.setSort('modifiedAt')">
                      <span>Modified On</span>
                      <span class="wcfm-sort">{{ sortIndicator('modifiedAt') }}</span>
                    </button>
                  </th>
                  <th class="wcfm-col-modby">
                    <span>Modified By</span>
                  </th>
                  <th class="wcfm-col-size">
                    <button type="button" class="wcfm-sortbtn" (click)="store.setSort('size')">
                      <span>Size</span>
                      <span class="wcfm-sort">{{ sortIndicator('size') }}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (item of store.items(); track item.id) {
                  <tr
                    class="wcfm-row"
                    tabindex="0"
                    draggable="true"
                    [class.is-selected]="store.selectedIds().has(item.id)"
                    [class.is-drop-target]="item.type === 'folder' && dropTargetPath() === item.path"
                    (click)="onItemRowClick(item, $event)"
                    (dblclick)="openItem(item)"
                    (contextmenu)="onItemContextMenu(item, $event)"
                    (keydown.enter)="openItem(item)"
                    (keydown.space)="toggleSingleItemSelection(item, $event)"
                    (dragstart)="onItemDragStart(item, $event)"
                    (dragend)="onItemDragEnd()"
                    (dragover)="item.type === 'folder' && onFolderDragOver(item.path, $event)"
                    (dragleave)="item.type === 'folder' && onFolderDragLeave(item.path)"
                    (drop)="item.type === 'folder' && onFolderDrop(item.path, $event)"
                  >
                    <td class="wcfm-col-check">
                      <label class="wcfm-check">
                        <input
                          type="checkbox"
                          [attr.aria-label]="'Select ' + item.name"
                          [checked]="store.selectedIds().has(item.id)"
                          (click)="onCheckboxClick(item, $event)"
                        />
                      </label>
                    </td>
                    <td class="wcfm-col-name">
                      <span class="wcfm-name">
                        @if (item.type === 'folder') {
                          <span class="wcfm-icon wcfm-folder-icon" [innerHTML]="icons.folderBrand" aria-hidden="true"></span>
                        } @else {
                          <span
                            [attr.class]="'wcfm-icon wcfm-file-icon kind-' + fileIconKind(item)"
                            [innerHTML]="fileIconFor(item)"
                            aria-hidden="true"
                          ></span>
                        }
                        <span class="wcfm-name-text">{{ item.name }}</span>
                      </span>
                    </td>
                    @if (store.flatFilesMode()) {
                      <td class="wcfm-col-location" [title]="parentFolderPath(item)">
                        <code class="wcfm-location-path">{{ parentFolderPath(item) }}</code>
                      </td>
                    }
                    <td class="wcfm-col-modified">{{ formatDate(item.modifiedAt) }}</td>
                    <td class="wcfm-col-modby">{{ item.owner ?? '—' }}</td>
                    <td class="wcfm-col-size">{{ item.type === 'folder' ? '—' : formatSize(item.size) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else if (store.viewMode() === 'grid' && !store.flatFilesMode()) {
            <div class="wcfm-grid-wrap">
              <div class="wcfm-grid-toolbar" role="group" aria-label="Selection">
                <label class="wcfm-check">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    [checked]="allSelected()"
                    [indeterminate]="someSelected()"
                    (change)="onSelectAllChange($event)"
                  />
                </label>
              </div>
              <div class="wcfm-grid">
                @for (item of store.items(); track item.id) {
                  <div
                    class="wcfm-card"
                    tabindex="0"
                    draggable="true"
                    [class.is-selected]="store.selectedIds().has(item.id)"
                    [class.is-drop-target]="item.type === 'folder' && dropTargetPath() === item.path"
                    [attr.title]="item.name"
                    (contextmenu)="onItemContextMenu(item, $event)"
                    (keydown.enter)="openItem(item)"
                    (keydown.space)="toggleSingleItemSelection(item, $event)"
                    (dragstart)="onItemDragStart(item, $event)"
                    (dragend)="onItemDragEnd()"
                    (dragover)="item.type === 'folder' && onFolderDragOver(item.path, $event)"
                    (dragleave)="item.type === 'folder' && onFolderDragLeave(item.path)"
                    (drop)="item.type === 'folder' && onFolderDrop(item.path, $event)"
                  >
                    @if (tileItemDir(); as dir) {
                      <ng-container *ngTemplateOutlet="dir.templateRef; context: { $implicit: item, selected: store.selectedIds().has(item.id) }"></ng-container>
                    } @else {
                      <div class="wcfm-card-header">
                        <button
                          type="button"
                          class="wcfm-card-icon-hit"
                          tabindex="-1"
                          [attr.title]="item.name"
                          (click)="onItemRowClick(item, $event)"
                          (dblclick)="openItem(item)"
                        >
                          @if (item.type === 'folder') {
                            <span class="wcfm-icon wcfm-icon-card wcfm-folder-icon" [innerHTML]="icons.folderBrand" aria-hidden="true"></span>
                          } @else {
                            <span
                              [attr.class]="'wcfm-icon wcfm-icon-card wcfm-file-icon kind-' + fileIconKind(item)"
                              [innerHTML]="fileIconFor(item)"
                              aria-hidden="true"
                            ></span>
                          }
                        </button>
                        <label class="wcfm-check wcfm-card-check">
                          <input
                            type="checkbox"
                            [attr.aria-label]="'Select ' + item.name"
                            [checked]="store.selectedIds().has(item.id)"
                            (click)="onCheckboxClick(item, $event)"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        class="wcfm-card-body"
                        tabindex="-1"
                        [attr.title]="item.name"
                        (click)="onItemRowClick(item, $event)"
                        (dblclick)="openItem(item)"
                      >
                        <span class="wcfm-card-name">{{ item.name }}</span>
                        <span class="wcfm-card-meta">{{ item.type === 'folder' ? 'Folder' : formatSize(item.size) }}</span>
                      </button>
                    }
                  </div>
                }
              </div>
            </div>
          }
          @if (store.loading() && store.items().length > 0) {
            <div class="wcfm-refresh-overlay" aria-hidden="true">
              <span class="wcfm-refresh-spinner"></span>
            </div>
          }
          </div>
          </div>

          @if (!store.error() && store.total() > 0 && (!store.loading() || store.items().length > 0)) {
            <footer
              class="wcfm-pagination"
              [class.is-refreshing]="store.loading() && store.items().length > 0"
              aria-label="Pagination"
            >
              <span class="wcfm-page-summary">
                {{ pageRangeStart() }}–{{ pageRangeEnd() }} of {{ store.total() }}
              </span>
              <label class="wcfm-page-size">
                <span>Rows</span>
                <select
                  name="wcfmPageSize"
                  [ngModel]="store.pageSize()"
                  (ngModelChange)="store.setPageSize($event)"
                  [disabled]="store.loading()"
                >
                  @for (size of pageSizeOptions; track size) {
                    <option [ngValue]="size">{{ size }}</option>
                  }
                </select>
              </label>
              <div class="wcfm-page-controls" role="group" aria-label="Page navigation">
                <button
                  type="button"
                  class="wcfm-vbtn"
                  [disabled]="store.loading() || store.pageIndex() === 0"
                  aria-label="First page"
                  title="First page"
                  (click)="goToFirstPage()"
                >«</button>
                <button
                  type="button"
                  class="wcfm-vbtn"
                  [disabled]="store.loading() || store.pageIndex() === 0"
                  aria-label="Previous page"
                  title="Previous page"
                  (click)="goToPrevPage()"
                >‹</button>
                <span class="wcfm-page-indicator">
                  Page {{ store.pageIndex() + 1 }} / {{ store.pageCount() }}
                </span>
                <button
                  type="button"
                  class="wcfm-vbtn"
                  [disabled]="store.loading() || store.pageIndex() >= store.pageCount() - 1"
                  aria-label="Next page"
                  title="Next page"
                  (click)="goToNextPage()"
                >›</button>
                <button
                  type="button"
                  class="wcfm-vbtn"
                  [disabled]="store.loading() || store.pageIndex() >= store.pageCount() - 1"
                  aria-label="Last page"
                  title="Last page"
                  (click)="goToLastPage()"
                >»</button>
              </div>
            </footer>
          }
        </main>

        @if (showPreview()) {
          <aside class="wcfm-preview" aria-label="Preview pane">
            @if (previewItem(); as item) {
              <header class="wcfm-preview-header">
                <span
                  [attr.class]="'wcfm-icon wcfm-file-icon kind-' + fileIconKind(item)"
                  [innerHTML]="fileIconFor(item)"
                  aria-hidden="true"
                ></span>
                <h3 class="wcfm-preview-title">{{ item.name }}</h3>
              </header>
              <div class="wcfm-preview-body">
                @if (previewDir(); as dir) {
                  <ng-container *ngTemplateOutlet="dir.templateRef; context: { $implicit: item, loading: previewLoading() }"></ng-container>
                } @else if (previewLoading()) {
                  <p class="wcfm-state">Loading preview…</p>
                } @else if (previewKind() === 'image' && previewImageUrl(); as src) {
                  <img class="wcfm-preview-image" [src]="src" [alt]="item.name" />
                } @else if (previewKind() === 'pdf' && previewPdfUrl(); as src) {
                  <iframe class="wcfm-preview-pdf" [src]="src" title="PDF preview"></iframe>
                } @else if (previewKind() === 'eml') {
                  <div class="wcfm-preview-eml">
                    @for (hdr of emlHeaders(); track hdr.key) {
                      <div class="wcfm-preview-eml-row">
                        <span class="wcfm-preview-eml-key">{{ hdr.key }}</span>
                        <span class="wcfm-preview-eml-val">{{ hdr.value }}</span>
                      </div>
                    }
                    @if (emlBodyIsHtml() && emlBodySafeHtml(); as safeHtml) {
                      <iframe class="wcfm-preview-eml-iframe" [srcdoc]="safeHtml" sandbox title="Email body"></iframe>
                    } @else {
                      <pre class="wcfm-preview-eml-body">{{ emlBody() }}</pre>
                    }
                  </div>
                } @else if (previewKind() === 'text' && previewText() !== null) {
                  <pre class="wcfm-preview-text">{{ previewText() }}</pre>
                } @else {
                  <p class="wcfm-state">Preview not available for this file.</p>
                }
              </div>
              <dl class="wcfm-preview-meta">
                <div><dt>Type</dt><dd>{{ item.extension ? item.extension.toUpperCase() : 'File' }}</dd></div>
                <div><dt>Size</dt><dd>{{ formatSize(item.size) }}</dd></div>
                <div><dt>Modified</dt><dd>{{ formatDate(item.modifiedAt) }}</dd></div>
                <div><dt>Owner</dt><dd>{{ item.owner ?? '—' }}</dd></div>
                <div><dt>Path</dt><dd class="wcfm-preview-path">{{ item.path }}</dd></div>
              </dl>
            } @else {
              <p class="wcfm-state wcfm-preview-empty">Select a file to preview.</p>
            }
          </aside>
        }
      </div>

      @if (contextMenu(); as menu) {
        <div class="wcfm-ctx" [style.left.px]="menu.x" [style.top.px]="menu.y" (click)="$event.stopPropagation()">
          @for (action of contextActions(); track action) {
            <button type="button" class="wcfm-ctx-item" [disabled]="isContextActionDisabled(action, menu.item)" (click)="onContextAction(action)">
              {{ contextActionLabel(action) }}
            </button>
          }
        </div>
      }

      @if (dialogAction(); as currentDialog) {
        <div class="wcfm-backdrop" (click)="closeDialog()">
          <section
            class="wcfm-dialog"
            [class.is-picker]="currentDialog === 'move' || currentDialog === 'copy'"
            (click)="$event.stopPropagation()"
          >
            <h3>{{ dialogTitle(currentDialog) }}</h3>

            @if (currentDialog === 'delete') {
              <p>Delete {{ store.selectedItems().length }} selected item{{ store.selectedItems().length === 1 ? '' : 's' }}?</p>
            } @else if (currentDialog === 'move' || currentDialog === 'copy') {
              <p class="wcfm-dialog-summary">
                {{ currentDialog === 'move' ? 'Moving' : 'Copying' }}
                {{ dialogSourceItems().length }} item{{ dialogSourceItems().length === 1 ? '' : 's' }}.
              </p>

              <div
                class="wcfm-picker-destination"
                role="region"
                aria-live="polite"
                [attr.aria-label]="dialogPickerDestinationAria()"
              >
                <span class="wcfm-icon wcfm-folder-icon wcfm-picker-destination-icon" [innerHTML]="icons.folderBrand" aria-hidden="true"></span>
                <div class="wcfm-picker-destination-path" [class.is-empty]="!dialogSelectedPath()">
                  @if (dialogSelectedPath(); as path) {
                    @for (seg of pathBreadcrumbLabels(path); track $index; let last = $last) {
                      <span class="wcfm-picker-destination-seg">{{ seg }}</span>
                      @if (!last) {
                        <span class="wcfm-picker-destination-sep" aria-hidden="true"> » </span>
                      }
                    }
                  } @else {
                    <span class="wcfm-picker-destination-placeholder">Choose a folder below…</span>
                  }
                </div>
              </div>

              @if (dialogPickerError(); as err) {
                @if (dialogSelectedPath()) {
                  <p class="wcfm-picker-error">{{ err }}</p>
                }
              }

              <div class="wcfm-picker" role="tree" aria-label="Destination folder">
                <button
                  type="button"
                  class="wcfm-picker-row"
                  [class.is-active]="dialogSelectedPath() === '/'"
                  [disabled]="isInvalidDialogTarget('/')"
                  (click)="setDialogPath('/')"
                >
                  <span class="wcfm-picker-toggle-spacer" aria-hidden="true"></span>
                  <span class="wcfm-icon wcfm-folder-icon" [innerHTML]="icons.folderBrand" aria-hidden="true"></span>
                  <span class="wcfm-picker-label">Root</span>
                  <code class="wcfm-picker-path">/</code>
                </button>

                @if (store.treeLoading() && !dialogTreeRows().length) {
                  <p class="wcfm-state">Loading folders…</p>
                } @else if (store.treeError()) {
                  <p class="wcfm-state wcfm-error">{{ store.treeError()?.message }}</p>
                } @else {
                  @for (row of dialogTreeRows(); track row.item.path) {
                    <div class="wcfm-picker-row-wrap" [style.padding-left.px]="row.depth * 14">
                      <button
                        type="button"
                        class="wcfm-picker-toggle"
                        [disabled]="!row.hasChildren"
                        [attr.aria-label]="row.expanded ? 'Collapse folder' : 'Expand folder'"
                        (click)="toggleDialogFolder(row.item.path); $event.stopPropagation()"
                      >
                        @if (row.hasChildren) {
                          <span
                            class="wcfm-icon"
                            [innerHTML]="row.expanded ? icons.chevDown : icons.chevRight"
                            aria-hidden="true"
                          ></span>
                        }
                      </button>
                      <button
                        type="button"
                        class="wcfm-picker-row"
                        [class.is-active]="dialogSelectedPath() === row.item.path"
                        [disabled]="isInvalidDialogTarget(row.item.path)"
                        (click)="setDialogPath(row.item.path)"
                      >
                        <span class="wcfm-icon wcfm-folder-icon" [innerHTML]="icons.folderBrand" aria-hidden="true"></span>
                        <span class="wcfm-picker-label">{{ row.item.name }}</span>
                      </button>
                    </div>
                  }
                }
              </div>
            } @else {
              @if (currentDialog === 'new-folder') {
                <div
                  class="wcfm-picker-destination"
                  role="region"
                  aria-live="polite"
                  [attr.aria-label]="'New folder in: ' + store.currentPath()"
                >
                  <span class="wcfm-icon wcfm-folder-icon wcfm-picker-destination-icon" [innerHTML]="icons.folderBrand" aria-hidden="true"></span>
                  <div class="wcfm-picker-destination-path">
                    @for (seg of pathBreadcrumbLabels(store.currentPath()); track $index; let last = $last) {
                      <span class="wcfm-picker-destination-seg">{{ seg }}</span>
                      @if (!last) {
                        <span class="wcfm-picker-destination-sep" aria-hidden="true"> » </span>
                      }
                    }
                  </div>
                </div>
              }
              <label class="wcfm-field">
                <span>{{ dialogInputLabel(currentDialog) }}</span>
                <input
                  #dialogInput
                  name="dialogInput"
                  autocomplete="off"
                  [value]="dialogValue()"
                  [placeholder]="dialogPlaceholder(currentDialog)"
                  (input)="onDialogInput($event)"
                />
              </label>
            }

            <div class="wcfm-dialog-actions">
              <button type="button" class="wcfm-btn" (click)="closeDialog()">Cancel</button>
              <button
                type="button"
                class="wcfm-btn is-primary"
                [disabled]="isConfirmDisabled()"
                (click)="confirmDialog()"
              >
                {{ currentDialog === 'move' ? 'Move here' : currentDialog === 'copy' ? 'Copy here' : 'Confirm' }}
              </button>
            </div>
          </section>
        </div>
      }

      @if (store.uploadProgress().length) {
        <section class="wcfm-uploads" aria-labelledby="wcfm-uploads-title" aria-live="polite">
          <header class="wcfm-uploads-head">
            <h3 id="wcfm-uploads-title" class="wcfm-uploads-title">
              Uploads ({{ uploadCompletedCount() }}/{{ uploadTotalCount() }})
            </h3>
            <div class="wcfm-uploads-actions">
              <button
                type="button"
                class="wcfm-uploads-clear"
                [disabled]="!uploadHasClearableRows()"
                (click)="store.clearFinishedUploads()"
              >
                Clear
              </button>
              <button type="button" class="wcfm-uploads-close" aria-label="Close uploads" (click)="store.dismissUploadPanel()">
                ×
              </button>
            </div>
          </header>
          <div class="wcfm-uploads-list">
            @for (entry of store.uploadProgress(); track entry.uploadId ?? entry.fileName) {
              <div class="wcfm-upload-row" [class.is-failed]="entry.status === 'failed'">
                <div class="wcfm-upload-row-top">
                  <span class="wcfm-upload-name" [title]="entry.fileName">{{ entry.fileName }}</span>
                  <span class="wcfm-upload-size">{{ formatBytes(entry.total) }}</span>
                </div>
                <div class="wcfm-upload-row-bar">
                  <div class="wcfm-upload-track" aria-hidden="true">
                    <div
                      class="wcfm-upload-fill"
                      [class.is-done]="entry.status === 'completed'"
                      [class.is-failed]="entry.status === 'failed'"
                      [style.width.%]="uploadBarPercent(entry)"
                    ></div>
                  </div>
                  @if (entry.status === 'completed') {
                    <span class="wcfm-upload-pct wcfm-upload-check" aria-label="Uploaded">✓</span>
                  } @else if (entry.status === 'failed') {
                    <span class="wcfm-upload-pct wcfm-upload-fail" [attr.title]="entry.error?.message ?? 'Failed'" aria-label="Upload failed">!</span>
                  } @else {
                    <span class="wcfm-upload-pct">{{ entry.percent }}%</span>
                  }
                </div>
              </div>
            }
          </div>
        </section>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      box-sizing: border-box;
      min-height: 30rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif;
      color: #1f2937;
      color-scheme: light;
      font-size: 13px;
      line-height: 1.45;
      --wcfm-border: #e5e7eb;
      --wcfm-border-strong: #d1d5db;
      --wcfm-muted: #6b7280;
      --wcfm-bg-alt: #f9fafb;
      --wcfm-hover: #f3f4f6;
      --wcfm-accent: #f97316;
      --wcfm-accent-soft: #fff4ec;
      --wcfm-accent-soft-2: #fee9d7;
      --wcfm-accent-strong: #ea580c;
    }
    :host.wcfm-fixed-height {
      min-height: 0;
    }
    :host.wcfm-is-resizing-tree {
      cursor: col-resize;
      user-select: none;
    }
    :host.wcfm-fixed-height .wcfm {
      height: 100%;
      min-height: 0;
    }

    .wcfm {
      position: relative;
      background: #fff;
      border: 1px solid var(--wcfm-border);
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 30rem;
    }
    .wcfm.wcfm-external-drop-active {
      border: 2px dashed var(--wcfm-accent);
      box-shadow: none;
    }
    .wcfm.wcfm-external-drop-active::after {
      content: 'Drop files or folders to upload';
      position: absolute;
      inset: 0;
      z-index: 60;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: clamp(7rem, 22vmin, 15rem) 1.5rem 3rem;
      text-align: center;
      font-size: 17px;
      font-weight: 700;
      letter-spacing: 0.02em;
      line-height: 1.35;
      color: var(--wcfm-accent);
      pointer-events: none;
      background: rgba(255, 247, 237, 0.55);
      border-radius: inherit;
      animation: wcfm-external-drop-soft 2.4s ease-in-out infinite;
    }
    @keyframes wcfm-external-drop-soft {
      0%,
      100% {
        background: rgba(255, 247, 237, 0.52);
      }
      50% {
        background: rgba(255, 237, 213, 0.62);
      }
    }
    .wcfm-skip {
      position: absolute; left: 8px; top: -40px; z-index: 100;
      background: #111; color: #fff; padding: 6px 10px; border-radius: 4px;
      text-decoration: none;
    }
    .wcfm-skip:focus { top: 8px; }
    .wcfm-hidden { display: none; }

    .wcfm-toolbar {
      display: flex; align-items: center; gap: 4px;
      padding: 6px 12px; flex-wrap: wrap;
      border-bottom: 1px solid var(--wcfm-border);
      background: var(--wcfm-bg-alt);
    }
    .wcfm-toolbar-left, .wcfm-toolbar-right {
      display: flex; align-items: center; gap: 2px;
    }
    .wcfm-toolbar-upload-group {
      display: inline-flex; align-items: center; gap: 2px; flex-wrap: nowrap; flex-shrink: 0;
    }
    .wcfm-toolbar-right { margin-left: auto; gap: 8px; }

    .wcfm-tbtn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 9px; border: 1px solid transparent;
      border-radius: 4px; background: transparent; color: #1f2937;
      font: inherit; cursor: pointer;
    }
    .wcfm-tbtn:hover:not([disabled]) { background: var(--wcfm-hover); }
    .wcfm-tbtn[disabled] { opacity: 0.4; cursor: not-allowed; }
    .wcfm-tbtn:focus-visible,
    .wcfm-vbtn:focus-visible,
    .wcfm-card-icon-hit:focus-visible,
    .wcfm-sortbtn:focus-visible,
    .wcfm-crumb:focus-visible,
    .wcfm-tree-toggle:focus-visible,
    .wcfm-tree-label:focus-visible,
    .wcfm-btn:focus-visible,
    .wcfm-ctx-item:focus-visible {
      outline: 2px solid var(--wcfm-accent);
      outline-offset: 1px;
    }

    .wcfm-divider {
      width: 1px; height: 18px; background: var(--wcfm-border-strong); margin: 0 4px;
    }

    .wcfm-viewgroup {
      display: inline-flex; border: 1px solid var(--wcfm-border-strong);
      border-radius: 4px; overflow: hidden; background: #fff;
    }
    .wcfm-vbtn {
      width: 28px; height: 26px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      border: none; background: transparent; cursor: pointer; color: var(--wcfm-muted);
    }
    .wcfm-vbtn:hover { background: var(--wcfm-hover); color: #111; }
    .wcfm-vbtn.is-active { background: var(--wcfm-accent-soft); color: var(--wcfm-accent-strong); }
    .wcfm-vbtn + .wcfm-vbtn { border-left: 1px solid var(--wcfm-border); }

    .wcfm-search {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 0 8px; min-width: 240px;
      border: 1px solid var(--wcfm-border-strong); border-radius: 4px;
      background: #fff;
    }
    .wcfm-search-icon { color: var(--wcfm-muted); }
    .wcfm-search input {
      border: none; outline: none; padding: 5px 0;
      background: transparent; font: inherit; flex: 1; min-width: 0; color: #111;
    }

    .wcfm-crumbs {
      display: flex; align-items: center; gap: 2px; flex-wrap: wrap;
      padding: 6px 12px; border-bottom: 1px solid var(--wcfm-border);
      background: #fff; font-size: 12px;
    }
    .wcfm-crumb {
      border: none; background: transparent; color: var(--wcfm-muted);
      padding: 2px 6px; border-radius: 3px; cursor: pointer; font: inherit;
    }
    .wcfm-crumb:hover { background: var(--wcfm-hover); color: #111; }
    .wcfm-crumb.is-current { color: #111; font-weight: 600; }
    .wcfm-crumb-sep { color: var(--wcfm-muted); padding: 0 2px; }
    .wcfm-crumb-count {
      margin-left: auto; color: var(--wcfm-muted); font-size: 11px;
      font-variant-numeric: tabular-nums;
    }

    .wcfm-body {
      position: relative;
      display: grid;
      --wcfm-tree-pane: ${WCFM_TREE_PANE_DEFAULT_PX}px;
      --wcfm-tree-pane-min: ${WCFM_TREE_PANE_MIN_PX}px;
      --wcfm-splitter: ${WCFM_TREE_SPLITTER_TRACK_PX}px;
      grid-template-columns: minmax(var(--wcfm-tree-pane-min), var(--wcfm-tree-pane)) var(--wcfm-splitter) minmax(0, 1fr);
      flex: 1; min-height: 0;
    }
    .wcfm-body.wcfm-body-flat {
      grid-template-columns: minmax(0, 1fr);
    }
    .wcfm-tree {
      border-right: none;
      min-height: 0;
      min-width: var(--wcfm-tree-pane-min);
      overflow-y: auto;
      overflow-x: auto;
      padding: 8px 4px; background: #fff;
    }
    .wcfm-tree-splitter {
      align-self: stretch;
      width: 100%;
      min-width: 0;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      cursor: col-resize;
      touch-action: none;
      position: relative;
      z-index: 2;
    }
    .wcfm-tree-splitter:hover {
      background: var(--wcfm-hover);
    }
    .wcfm-tree-splitter:focus-visible {
      background: var(--wcfm-hover);
      outline: 2px solid var(--wcfm-accent);
      outline-offset: -1px;
    }
    .wcfm-tree-splitter::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      width: 1px;
      transform: translateX(-50%);
      background: var(--wcfm-border);
      pointer-events: none;
    }
    .wcfm-tree-stack {
      position: relative;
      min-height: 95%;
    }
    .wcfm-tree-stack.is-refreshing .wcfm-tree-list {
      pointer-events: none;
      user-select: none;
      opacity: 0.72;
      transition: opacity 0.18s ease-out;
    }
    .wcfm-tree-refresh-overlay {
      padding: 1.25rem;
    }
    .wcfm-main {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
      background: #fff;
    }
    .wcfm-main-scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }

    .wcfm-list-stack {
      position: relative;
    }
    .wcfm-list-stack.is-refreshing .wcfm-table,
    .wcfm-list-stack.is-refreshing .wcfm-grid,
    .wcfm-list-stack.is-refreshing .wcfm-grid-wrap {
      pointer-events: none;
      user-select: none;
      opacity: 0.72;
      transition: opacity 0.18s ease-out;
    }
    .wcfm-refresh-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      background: rgba(255, 255, 255, 0.28);
      pointer-events: none;
      animation: wcfm-refresh-overlay-in 0.22s ease-out;
    }
    .wcfm-refresh-spinner {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid rgba(249, 115, 22, 0.22);
      border-top-color: var(--wcfm-accent);
      animation: wcfm-spin 0.65s linear infinite;
    }
    @keyframes wcfm-refresh-overlay-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes wcfm-spin {
      to { transform: rotate(360deg); }
    }

    .wcfm-tree-list { list-style: none; margin: 0; padding: 0; }
    .wcfm-tree-row {
      display: flex; align-items: center; gap: 4px;
      padding: 3px 8px 3px 4px;
      border-radius: 3px;
      border-left: 3px solid transparent;
      margin: 1px 0;
    }
    .wcfm-tree-row:hover { background: var(--wcfm-hover); }
    .wcfm-tree-row.is-active {
      background: var(--wcfm-accent-soft);
      border-left-color: var(--wcfm-accent);
      font-weight: 600;
    }
    .wcfm-tree-row.is-drop-target,
    .wcfm-row.is-drop-target,
    .wcfm-card.is-drop-target,
    .wcfm-crumb.is-drop-target {
      position: relative;
      z-index: 1;
      outline: none;
      background: linear-gradient(
        135deg,
        var(--wcfm-accent-soft) 0%,
        var(--wcfm-accent-soft-2) 100%
      );
      box-shadow:
        inset 0 0 0 2px var(--wcfm-accent),
        0 0 0 1px rgba(255, 255, 255, 0.5) inset,
        0 4px 18px rgba(249, 115, 22, 0.28);
      animation: wcfm-folder-drop-pulse 1.1s ease-in-out infinite;
    }
    .wcfm-tree-row.is-drop-target {
      border-left-color: var(--wcfm-accent-strong);
    }
    .wcfm-crumb.is-drop-target {
      color: var(--wcfm-accent-strong);
      font-weight: 600;
    }
    .wcfm-card.is-drop-target {
      border-color: var(--wcfm-accent);
    }
    @keyframes wcfm-folder-drop-pulse {
      0%,
      100% {
        box-shadow:
          inset 0 0 0 2px var(--wcfm-accent),
          0 0 0 1px rgba(255, 255, 255, 0.5) inset,
          0 2px 12px rgba(249, 115, 22, 0.22);
      }
      50% {
        box-shadow:
          inset 0 0 0 2px var(--wcfm-accent-strong),
          0 0 0 1px rgba(255, 255, 255, 0.55) inset,
          0 6px 22px rgba(249, 115, 22, 0.38);
      }
    }
    .wcfm-tree-toggle {
      width: 18px; height: 18px; border: none; background: transparent;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; padding: 0; color: var(--wcfm-muted);
    }
    .wcfm-tree-toggle[disabled] { cursor: default; opacity: 0.25; }
    .wcfm-tree-label {
      flex: 1 1 auto;
      min-width: min-content;
      display: inline-flex; align-items: center; gap: 6px;
      border: none; background: transparent; cursor: pointer; padding: 0;
      font: inherit; color: inherit; text-align: left;
    }
    .wcfm-tree-name {
      white-space: nowrap;
    }
    .wcfm-tree-count {
      font-size: 11px;
      color: var(--wcfm-accent-strong);
      background: var(--wcfm-accent-soft-2);
      border-radius: 999px;
      padding: 1px 7px;
      min-width: 18px; text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .wcfm-tree-skel {
      height: 22px; margin: 4px;
      border-radius: 3px;
      background: linear-gradient(90deg, #f6f7f8 25%, #eceef1 45%, #f6f7f8 65%);
      background-size: 220% 100%;
      animation: wcfm-shim 2s ease-in-out infinite;
    }

    .wcfm-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 16px; height: 16px; flex: 0 0 auto;
    }
    .wcfm-icon svg { width: 100%; height: 100%; }
    .wcfm-folder-icon,
    .wcfm-file-icon {
      color: #6b7280;
    }
    .wcfm-folder-icon .wcfm-brand-icon,
    .wcfm-file-icon .wcfm-brand-icon {
      display: block;
      width: 100%;
      height: 100%;
    }
    .wcfm-file-icon.kind-code {
      color: #4f46e5;
    }

    .wcfm-table {
      width: 100%;
      min-width: 38rem;
      table-layout: fixed;
      border-collapse: collapse;
    }
    .wcfm-table-flat {
      min-width: 46rem;
    }
    .wcfm-table thead th {
      text-align: left;
      font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--wcfm-muted);
      padding: 8px 12px;
      background: var(--wcfm-bg-alt);
      border-bottom: 1px solid var(--wcfm-border);
      position: sticky; top: 0; z-index: 1;
      white-space: nowrap;
    }
    .wcfm-table tbody td {
      padding: 8px 12px; font-size: 13px; vertical-align: middle;
      border-bottom: 1px solid #f3f4f6;
    }
    .wcfm-col-check { width: 36px; padding-right: 0 !important; }
    .wcfm-col-name {
      min-width: 0;
      overflow: hidden;
      vertical-align: middle;
    }
    .wcfm-col-location {
      width: 11rem;
      min-width: 8rem;
      max-width: 14rem;
      color: var(--wcfm-muted);
      vertical-align: middle;
    }
    .wcfm-location-path {
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wcfm-col-modified {
      width: 13.5rem;
      min-width: 13.5rem;
      color: var(--wcfm-muted);
      white-space: nowrap;
    }
    .wcfm-col-modby {
      width: 9.5rem;
      min-width: 9.5rem;
      color: var(--wcfm-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wcfm-col-size {
      width: 5.75rem;
      min-width: 5.75rem;
      color: var(--wcfm-muted);
      text-align: right;
      white-space: nowrap;
    }

    .wcfm-sortbtn {
      display: inline-flex; align-items: center; gap: 4px;
      border: none; background: transparent; padding: 0;
      cursor: pointer; font: inherit; color: inherit;
      text-transform: inherit; letter-spacing: inherit;
    }
    .wcfm-sortbtn[disabled] { cursor: default; }
    .wcfm-sort { color: #9ca3af; font-size: 11px; }

    .wcfm-row { cursor: default; user-select: none; }
    .wcfm-row:hover { background: var(--wcfm-hover); }
    .wcfm-row.is-selected { background: var(--wcfm-accent-soft); }
    .wcfm-row.is-selected td:first-child { box-shadow: inset 3px 0 0 0 var(--wcfm-accent); }
    .wcfm-row.is-selected:hover { background: var(--wcfm-accent-soft-2); }
    .wcfm-row:focus-visible { outline: 2px solid var(--wcfm-accent); outline-offset: -2px; }

    .wcfm-name { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
    .wcfm-name-text {
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .wcfm-check { display: inline-flex; align-items: center; }
    .wcfm-check input { margin: 0; cursor: pointer; accent-color: var(--wcfm-accent); }

    .wcfm-grid-wrap {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    .wcfm-grid-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--wcfm-border);
      background: var(--wcfm-bg-alt);
      flex-shrink: 0;
    }
    .wcfm-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 8px; padding: 12px;
    }
    .wcfm-card {
      border: 1px solid var(--wcfm-border); border-radius: 4px;
      background: #fff;
      display: flex; flex-direction: column;
      align-items: stretch; min-width: 0;
      font: inherit; color: inherit;
      cursor: default;
      outline: none;
    }
    .wcfm-card:hover { background: var(--wcfm-hover); }
    .wcfm-card:focus-visible {
      outline: 2px solid var(--wcfm-accent);
      outline-offset: -2px;
    }
    .wcfm-card.is-selected {
      background: var(--wcfm-accent-soft);
      border-color: var(--wcfm-accent);
    }
    .wcfm-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px 0;
      min-width: 0;
    }
    .wcfm-card-icon-hit {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      cursor: default;
      font: inherit;
      color: inherit;
      flex: 0 0 auto;
    }
    .wcfm-card-check {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      margin: 0;
      padding: 2px;
      border-radius: 3px;
    }
    .wcfm-card-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-start;
      min-width: 0;
      width: 100%;
      padding: 8px 12px 12px;
      border: none;
      background: transparent;
      cursor: default;
      text-align: left;
      font: inherit;
      color: inherit;
    }
    .wcfm-icon-card { width: 32px; height: 32px; }
    .wcfm-card-name {
      font-size: 13px; word-break: break-word; line-height: 1.3;
    }
    .wcfm-card-meta { font-size: 11px; color: var(--wcfm-muted); }

    .wcfm-toast-stack {
      grid-column: 1 / -1;
      grid-row: 1;
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 35;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: min(22rem, calc(100% - 1.5rem));
      width: max-content;
      pointer-events: none;
    }
    .wcfm-toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 9px;
      padding: 11px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.4;
      color: #14532d;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left: 3px solid #16a34a;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.04);
      animation: wcfm-toast-in 0.22s ease-out;
    }
    .wcfm-toast-icon { color: #16a34a; margin-top: 1px; }
    .wcfm-toast.is-error {
      color: #991b1b;
      background: #fef2f2;
      border-color: #fecaca;
      border-left-color: #dc2626;
    }
    .wcfm-toast.is-error .wcfm-toast-icon { color: #dc2626; }
    @keyframes wcfm-toast-in {
      from {
        opacity: 0;
        transform: translateX(10px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    .wcfm-validation-banner {
      margin: 8px 12px;
      padding: 12px 14px;
      border: 1px solid #fcd9b3;
      background: #fff4ec;
      color: #7c2d12;
      border-radius: 6px;
      font-size: 13px;
      line-height: 1.45;
    }
    .wcfm-validation-banner-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .wcfm-validation-heading {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #9a3412;
      text-wrap: balance;
    }
    .wcfm-validation-dismiss {
      flex-shrink: 0;
      padding: 4px 10px;
      border: 1px solid var(--wcfm-border-strong);
      border-radius: 4px;
      background: #fff;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      color: #7c2d12;
      cursor: pointer;
    }
    .wcfm-validation-dismiss:hover {
      background: var(--wcfm-hover);
    }
    .wcfm-validation-dismiss:focus-visible {
      outline: 2px solid var(--wcfm-accent);
      outline-offset: 1px;
    }
    .wcfm-validation-list {
      margin: 0;
      padding-left: 1.2rem;
    }
    .wcfm-validation-item {
      margin: 0 0 6px;
    }
    .wcfm-validation-item:last-child {
      margin-bottom: 0;
    }
    .wcfm-validation-file-wrap {
      display: block;
      margin-bottom: 2px;
    }
    .wcfm-validation-file {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      font-weight: 600;
      color: #431407;
      word-break: break-all;
    }
    .wcfm-validation-msg {
      display: block;
      min-width: 0;
      text-wrap: pretty;
      color: #9a3412;
    }
    .wcfm-state { margin: 12px; color: var(--wcfm-muted); font-size: 12px; }
    .wcfm-error { color: #b91c1c; }
    .wcfm-empty {
      margin: 24px auto; padding: 24px; max-width: 28rem;
      border: 1px dashed var(--wcfm-border-strong);
      border-radius: 4px; text-align: center; color: var(--wcfm-muted);
    }
    .wcfm-empty h3 { margin: 0 0 4px; color: #111; font-size: 14px; }
    .wcfm-empty p { margin: 0; font-size: 12px; }

    .wcfm-skeleton { display: grid; gap: 6px; padding: 12px; }
    .wcfm-skel-row {
      height: 28px; border-radius: 3px;
      background: linear-gradient(90deg, #f6f7f8 25%, #eceef1 45%, #f6f7f8 65%);
      background-size: 220% 100%; animation: wcfm-shim 2s ease-in-out infinite;
    }
    .wcfm-skel-card {
      min-height: 80px; border-radius: 4px;
      background: linear-gradient(90deg, #f6f7f8 25%, #eceef1 45%, #f6f7f8 65%);
      background-size: 220% 100%; animation: wcfm-shim 2s ease-in-out infinite;
    }
    @keyframes wcfm-shim {
      0% { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }

    .wcfm-ctx {
      position: fixed; z-index: 30; min-width: 11rem;
      border: 1px solid var(--wcfm-border); border-radius: 4px;
      background: #fff; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
      padding: 4px;
    }
    .wcfm-ctx-item {
      display: block; width: 100%; text-align: left;
      border: none; background: transparent; padding: 6px 10px;
      border-radius: 3px; cursor: pointer; font: inherit; color: #111;
    }
    .wcfm-ctx-item:hover { background: var(--wcfm-hover); }

    .wcfm-backdrop {
      position: fixed; inset: 0;
      background: rgba(15, 23, 42, 0.4);
      display: grid; place-items: center;
      overscroll-behavior: contain; z-index: 40;
    }
    .wcfm-dialog {
      width: min(28rem, calc(100vw - 2rem));
      max-width: min(28rem, calc(100vw - 2rem));
      box-sizing: border-box;
      background: #fff;
      border: 1px solid var(--wcfm-border); border-radius: 6px;
      padding: 16px;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
      min-width: 0;
    }
    .wcfm-dialog.is-picker {
      width: min(34rem, calc(100vw - 2rem));
      max-width: min(34rem, calc(100vw - 2rem));
    }
    .wcfm-dialog-summary {
      margin: 0; color: var(--wcfm-muted); font-size: 12px;
    }
    .wcfm-picker-destination {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      min-width: 0;
      box-sizing: border-box;
      padding: 8px 12px;
      border: 1px solid var(--wcfm-border-strong);
      border-radius: 8px;
      background: #f1f5f9;
      color: #334155;
    }
    .wcfm-picker-destination-icon {
      flex: 0 0 auto;
      margin-top: 2px;
      opacity: 0.55;
      color: #64748b;
    }
    .wcfm-picker-destination-path {
      flex: 1 1 0%;
      min-width: 0;
      font: inherit;
      font-size: 13px;
      line-height: 1.45;
      font-weight: 500;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .wcfm-picker-destination-sep {
      color: #94a3b8;
      font-weight: 400;
    }
    .wcfm-picker-destination-placeholder {
      color: var(--wcfm-muted);
      font-weight: 400;
      font-style: italic;
    }
    .wcfm-picker-destination-path.is-empty {
      color: var(--wcfm-muted);
      font-style: italic;
      font-weight: 400;
    }
    .wcfm-picker-error {
      margin: 0; padding: 6px 10px;
      background: #fff4ec; border: 1px solid #fcd9b3;
      border-radius: 4px;
      color: #9a3412; font-size: 12px;
    }
    .wcfm-picker {
      max-height: 18rem; overflow: auto;
      border: 1px solid var(--wcfm-border); border-radius: 4px;
      padding: 4px; background: #fff;
    }
    .wcfm-picker-row-wrap {
      display: flex; align-items: center; gap: 2px;
    }
    .wcfm-picker-toggle {
      width: 18px; height: 26px;
      border: none; background: transparent; cursor: pointer; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--wcfm-muted); flex: 0 0 auto;
    }
    .wcfm-picker-toggle[disabled] {
      cursor: default; opacity: 0.25;
    }
    .wcfm-picker-toggle-spacer { width: 18px; flex: 0 0 auto; }
    .wcfm-picker-row {
      display: inline-flex; align-items: center; gap: 8px;
      flex: 1; min-width: 0;
      padding: 4px 8px;
      border: 1px solid transparent; border-radius: 3px;
      background: transparent; cursor: pointer; font: inherit; color: inherit;
      text-align: left;
    }
    .wcfm-picker-row:hover:not([disabled]) { background: var(--wcfm-hover); }
    .wcfm-picker-row.is-active {
      background: var(--wcfm-accent-soft);
      border-color: var(--wcfm-accent);
      color: var(--wcfm-accent-strong);
      font-weight: 600;
    }
    .wcfm-picker-row[disabled] {
      color: var(--wcfm-muted); cursor: not-allowed; opacity: 0.5;
    }
    .wcfm-picker-label {
      flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .wcfm-picker-path {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px; color: var(--wcfm-muted);
    }
    .wcfm-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .wcfm-dialog h3 { margin: 0; font-size: 14px; min-width: 0; }
    .wcfm-field {
      display: grid;
      gap: 6px;
      font-size: 12px;
      min-width: 0;
    }
    .wcfm-field input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      border: 1px solid var(--wcfm-border-strong); border-radius: 4px;
      padding: 6px 8px; font: inherit;
    }
    .wcfm-dialog-actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }
    .wcfm-btn {
      padding: 5px 12px;
      border: 1px solid var(--wcfm-border-strong);
      border-radius: 4px; background: #fff; font: inherit; cursor: pointer;
    }
    .wcfm-btn:hover { background: var(--wcfm-hover); }
    .wcfm-btn.is-primary {
      background: var(--wcfm-accent);
      border-color: var(--wcfm-accent);
      color: #fff;
    }
    .wcfm-btn.is-primary:hover { background: var(--wcfm-accent-strong); }

    .wcfm-uploads {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 34;
      width: min(22rem, calc(100vw - 2rem));
      max-height: min(22rem, 52vh);
      display: flex;
      flex-direction: column;
      background: #fff;
      border: 1px solid var(--wcfm-border-strong);
      border-radius: 8px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 8px rgba(15, 23, 42, 0.06);
      overflow: hidden;
    }
    .wcfm-uploads-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--wcfm-border);
      flex-shrink: 0;
    }
    .wcfm-uploads-title {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: #111827;
      font-variant-numeric: tabular-nums;
    }
    .wcfm-uploads-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .wcfm-uploads-clear {
      border: none;
      background: transparent;
      padding: 4px 8px;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      color: var(--wcfm-accent);
      cursor: pointer;
      border-radius: 4px;
    }
    .wcfm-uploads-clear:hover:not([disabled]) {
      background: var(--wcfm-accent-soft);
    }
    .wcfm-uploads-clear[disabled] {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .wcfm-uploads-close {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: #64748b;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    }
    .wcfm-uploads-close:hover {
      background: var(--wcfm-hover);
      color: #0f172a;
    }
    .wcfm-uploads-list {
      overflow-y: auto;
      padding: 4px 0;
      min-height: 0;
    }
    .wcfm-upload-row {
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
    }
    .wcfm-upload-row:last-child {
      border-bottom: none;
    }
    .wcfm-upload-row-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 6px;
    }
    .wcfm-upload-name {
      font-size: 13px;
      color: #0f172a;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wcfm-upload-size {
      font-size: 12px;
      color: var(--wcfm-muted);
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .wcfm-upload-row-bar {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .wcfm-upload-track {
      flex: 1;
      min-width: 0;
      height: 6px;
      border-radius: 999px;
      background: #e8ecf0;
      overflow: hidden;
    }
    .wcfm-upload-fill {
      height: 100%;
      border-radius: 999px;
      background: var(--wcfm-accent);
      transition: width 0.2s ease-out, background 0.2s ease;
    }
    .wcfm-upload-fill.is-done {
      background: #22c55e;
    }
    .wcfm-upload-fill.is-failed {
      background: #ef4444;
    }
    .wcfm-upload-pct {
      flex-shrink: 0;
      width: 2.25rem;
      text-align: right;
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--wcfm-muted);
    }
    .wcfm-upload-check {
      color: #16a34a;
      font-size: 14px;
      font-weight: 700;
    }
    .wcfm-upload-fail {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 999px;
      background: #fee2e2;
      color: #b91c1c;
      font-size: 12px;
      font-weight: 800;
    }
    .wcfm-upload-row.is-failed .wcfm-upload-name {
      color: #991b1b;
    }

    .wcfm-tbtn.is-active {
      background: var(--wcfm-accent-soft);
      color: var(--wcfm-accent-strong);
    }

    .wcfm-filter-panel {
      background: #fff;
      border-bottom: 1px solid var(--wcfm-border);
      padding: 12px;
      display: grid; gap: 10px;
    }
    .wcfm-filter-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
    }
    .wcfm-filter-field {
      display: grid; gap: 4px; font-size: 11px;
      color: var(--wcfm-muted); text-transform: uppercase; letter-spacing: 0.04em;
    }
    .wcfm-filter-field input {
      border: 1px solid var(--wcfm-border-strong); border-radius: 4px;
      padding: 6px 8px; font: inherit;
      color: #111; text-transform: none; letter-spacing: 0;
    }
    .wcfm-filter-actions {
      display: flex; justify-content: flex-end; gap: 6px;
    }

    .wcfm-body.has-preview:not(.wcfm-body-flat) {
      grid-template-columns: minmax(var(--wcfm-tree-pane-min), var(--wcfm-tree-pane)) var(--wcfm-splitter) minmax(0, 1fr) 280px;
    }
    .wcfm-body.has-preview.wcfm-body-flat {
      grid-template-columns: minmax(0, 1fr) 280px;
    }

    .wcfm-pagination {
      display: flex; align-items: center; gap: 16px;
      flex-shrink: 0;
      padding: 8px 12px;
      border-top: 1px solid var(--wcfm-border);
      background: var(--wcfm-bg-alt);
      font-size: 12px; color: var(--wcfm-muted);
    }
    .wcfm-page-summary { font-variant-numeric: tabular-nums; }
    .wcfm-page-size {
      display: inline-flex; align-items: center; gap: 6px;
      margin-left: auto;
    }
    .wcfm-page-size select {
      border: 1px solid var(--wcfm-border-strong); border-radius: 4px;
      padding: 3px 6px; background: #fff; font: inherit; color: #111;
    }
    .wcfm-page-controls {
      display: inline-flex; align-items: center; gap: 4px;
    }
    .wcfm-page-controls .wcfm-vbtn {
      width: 26px; height: 26px;
      border: 1px solid var(--wcfm-border-strong);
      border-radius: 4px; background: #fff;
    }
    .wcfm-page-controls .wcfm-vbtn:disabled {
      opacity: 0.4; cursor: not-allowed;
    }
    .wcfm-page-indicator {
      font-variant-numeric: tabular-nums;
      padding: 0 6px; min-width: 6rem; text-align: center; color: #111;
    }
    .wcfm-pagination.is-refreshing {
      opacity: 0.55;
      pointer-events: none;
      transition: opacity 0.18s ease-out;
    }

    .wcfm-preview {
      border-left: 1px solid var(--wcfm-border);
      background: #fff; padding: 12px;
      display: flex; flex-direction: column; gap: 12px;
      overflow: auto;
    }
    .wcfm-preview-header {
      display: flex; align-items: center; gap: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--wcfm-border);
    }
    .wcfm-preview-title {
      margin: 0; font-size: 13px; font-weight: 600;
      word-break: break-word;
    }
    .wcfm-preview-body {
      display: flex; align-items: center; justify-content: center;
      min-height: 8rem;
      background: var(--wcfm-bg-alt);
      border-radius: 4px;
      padding: 8px;
    }
    .wcfm-preview-image {
      max-width: 100%; max-height: 18rem; object-fit: contain;
      display: block;
    }
    .wcfm-preview-pdf {
      width: 100%; height: 18rem;
      border: none; border-radius: 4px; display: block;
    }
    .wcfm-preview-eml {
      width: 100%; max-height: 22rem; overflow: auto;
      background: #fff; border: 1px solid var(--wcfm-border);
      border-radius: 4px; font-size: 12px;
    }
    .wcfm-preview-eml-row {
      display: grid; grid-template-columns: 70px 1fr;
      gap: 4px; padding: 4px 8px;
      border-bottom: 1px solid var(--wcfm-border);
    }
    .wcfm-preview-eml-key { font-weight: 600; color: var(--wcfm-muted); }
    .wcfm-preview-eml-val { word-break: break-word; }
    .wcfm-preview-eml-body {
      margin: 0; padding: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px; line-height: 1.4; color: #111;
      white-space: pre-wrap; word-break: break-word;
    }
    .wcfm-preview-eml-iframe {
      width: 100%; min-height: 14rem; max-height: 18rem;
      border: none; display: block;
    }
    .wcfm-preview-text {
      width: 100%; max-height: 18rem; overflow: auto;
      margin: 0; padding: 8px;
      background: #fff; border: 1px solid var(--wcfm-border);
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px; line-height: 1.4; color: #111;
      white-space: pre-wrap; word-break: break-word;
    }
    .wcfm-preview-empty {
      text-align: center; padding: 24px 0;
    }
    .wcfm-preview-meta {
      margin: 0; padding: 0;
      display: grid; gap: 6px; font-size: 12px;
    }
    .wcfm-preview-meta div { display: grid; grid-template-columns: 80px 1fr; gap: 8px; }
    .wcfm-preview-meta dt {
      color: var(--wcfm-muted); font-weight: 500; margin: 0;
    }
    .wcfm-preview-meta dd { margin: 0; word-break: break-word; }
    .wcfm-preview-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }

    @media (max-width: 1100px) {
      .wcfm-body.has-preview:not(.wcfm-body-flat) {
        grid-template-columns: minmax(var(--wcfm-tree-pane-min), var(--wcfm-tree-pane)) var(--wcfm-splitter) minmax(0, 1fr);
      }
      .wcfm-body.has-preview.wcfm-body-flat {
        grid-template-columns: minmax(0, 1fr);
      }
      .wcfm-preview { display: none; }
    }

    @media (max-width: 900px) {
      .wcfm-body:not(.wcfm-body-flat),
      .wcfm-body.has-preview:not(.wcfm-body-flat) {
        grid-template-columns: 1fr;
      }
      .wcfm-body.wcfm-body-flat,
      .wcfm-body.has-preview.wcfm-body-flat {
        grid-template-columns: 1fr;
      }
      .wcfm-tree {
        border-right: none;
        border-bottom: 1px solid var(--wcfm-border);
        max-height: 12rem;
      }
      .wcfm-tree-splitter {
        display: none;
      }
      .wcfm-toolbar-right { margin-left: 0; width: 100%; flex-wrap: wrap; }
      .wcfm-search { min-width: 0; flex: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
      .wcfm-upload-fill { transition: none; }
      .wcfm-toast { animation: none; }
      .wcfm-tree-skel, .wcfm-skel-row, .wcfm-skel-card { animation: none; }
      .wcfm-refresh-overlay { animation: none; }
      .wcfm-refresh-spinner { animation: none; border-top-color: var(--wcfm-accent-strong); }
      .wcfm-list-stack.is-refreshing .wcfm-table,
      .wcfm-list-stack.is-refreshing .wcfm-grid,
      .wcfm-list-stack.is-refreshing .wcfm-grid-wrap { transition: none; }
      .wcfm-tree-stack.is-refreshing .wcfm-tree-list { transition: none; }
      .wcfm.wcfm-external-drop-active::after {
        animation: none;
        background: rgba(255, 247, 237, 0.58);
      }
      .wcfm-tree-row.is-drop-target,
      .wcfm-row.is-drop-target,
      .wcfm-card.is-drop-target,
      .wcfm-crumb.is-drop-target {
        animation: none;
      }
    }
  `,
})
export class WhitecapFileManagerComponent implements OnInit, OnDestroy {
  readonly provider = input<WhitecapStorageProvider | null>(null);
  readonly initialPath = input<string>('/');
  readonly actions = input<WhitecapToolbarAction[]>(DEFAULT_TOOLBAR_ACTIONS);
  readonly enableFolderUpload = input<boolean>(true);
  readonly uploadValidation = input<WhitecapUploadValidationConfig | null>(null);
  readonly defaultDuplicateStrategy = input<WhitecapDuplicateStrategy>('ask');
  readonly defaultPageSize = input<number>(50);
  /** Sets the initial visibility of the preview pane. The user can toggle it via the toolbar button. Defaults to false. */
  readonly previewPaneVisible = input<boolean>(false);
  /** Restricts visible file types globally (ANDed with any active user filter). Pass null to show all types. */
  readonly visibleFileTypes = input<string[] | null>(null);
  /** Limits which file extensions the built-in preview pane will attempt to load. Extensions without leading dots (e.g. `['pdf', 'png', 'txt']`). Pass null (default) to allow all types the provider supports. */
  readonly previewableExtensions = input<string[] | null>(null);
  /** CSS length for the explorer shell (e.g. `600px`, `42rem`, `min(70vh, 48rem)`). Fills the host; inner panes scroll. */
  readonly height = input<string | undefined>(undefined);

  readonly fixedHeightCss = computed(() => {
    const v = this.height()?.trim();
    return v ? v : null;
  });
  readonly hasFixedHeight = computed(() => this.fixedHeightCss() !== null);

  @Output() readonly fileOpened = new EventEmitter<WhitecapFileItem>();
  @Output() readonly folderChanged = new EventEmitter<string>();
  @Output() readonly uploadStarted = new EventEmitter<number>();
  @Output() readonly uploadCompleted = new EventEmitter<WhitecapUploadProgress>();
  @Output() readonly uploadFailed = new EventEmitter<WhitecapUploadProgress>();
  @Output() readonly fileDeleted = new EventEmitter<string[]>();
  @Output() readonly fileRenamed = new EventEmitter<WhitecapFileItem>();
  @Output() readonly fileMoved = new EventEmitter<string>();
  @Output() readonly fileCopied = new EventEmitter<string>();
  @Output() readonly selectionChanged = new EventEmitter<WhitecapFileItem[]>();
  @Output() readonly fileCreated = new EventEmitter<WhitecapFileItem>();
  @Output() readonly actionTriggered = new EventEmitter<WhitecapActionTriggeredEvent>();

  readonly fileUploadInput = viewChild<ElementRef<HTMLInputElement>>('fileUploadInput');
  readonly folderUploadInput = viewChild<ElementRef<HTMLInputElement>>('folderUploadInput');
  readonly dialogInput = viewChild<ElementRef<HTMLInputElement>>('dialogInput');
  readonly tileItemDir = contentChild(WcfmTileItemDirective);
  readonly previewDir = contentChild(WcfmPreviewDirective);

  readonly store = inject(FileManagerStore);
  readonly uploadCompletedCount = computed(
    () => this.store.uploadProgress().filter((e) => e.status === 'completed').length,
  );
  readonly uploadTotalCount = computed(() => this.store.uploadProgress().length);
  readonly uploadHasClearableRows = computed(() =>
    this.store.uploadProgress().some((e) => e.status === 'completed' || e.status === 'failed'),
  );
  private readonly sanitizer = inject(DomSanitizer);
  private readonly hostEl = inject(ElementRef<HTMLElement>);
  private treeSplitterMoveListener: ((ev: PointerEvent) => void) | null = null;
  private treeSplitterUpListener: ((ev: PointerEvent) => void) | null = null;
  private readonly fileTypeIcons = buildFileTypeIcons((svg) => this.sanitizer.bypassSecurityTrustHtml(svg));
  readonly toolbarActions = this.actions;
  /** In flat "Show All Files" mode, only these toolbar actions are shown (subset of `actions` input). */
  private readonly flatToolbarActionOrder = ['refresh', 'rename', 'delete', 'download'] as const;
  readonly primaryToolbarActions = computed(() => {
    const actions = this.toolbarActions();
    if (!this.store.flatFilesMode()) {
      return actions;
    }
    return this.flatToolbarActionOrder
      .map((id) => actions.find((a) => a.id === id))
      .filter((a): a is WhitecapToolbarAction => a !== undefined);
  });
  /** Splits toolbar actions so file upload and folder upload stay adjacent in the DOM. */
  readonly toolbarUploadSplit = computed(() => {
    const actions = this.primaryToolbarActions();
    const uploadIndex = actions.findIndex((a) => a.id === 'upload');
    if (uploadIndex < 0) {
      return {
        before: actions,
        uploadAction: null as WhitecapToolbarAction | null,
        after: [] as WhitecapToolbarAction[],
      };
    }
    return {
      before: actions.slice(0, uploadIndex),
      uploadAction: actions[uploadIndex]!,
      after: actions.slice(uploadIndex + 1),
    };
  });
  readonly supportsFolderUpload = computed(
    () => this.enableFolderUpload() && (this.provider()?.capabilities?.supportsFolderUpload ?? true),
  );
  readonly contextActions = computed<string[]>(() => [
    'open',
    ...this.actions()
      .filter((a) => !TOOLBAR_ONLY_IDS.has(a.id))
      .map((a) => a.id),
  ]);

  /** Folder tree pane width when the tree column is visible (not flat mode). */
  readonly treePaneWidthPx = signal(WCFM_TREE_PANE_DEFAULT_PX);
  readonly treePaneMinPx = WCFM_TREE_PANE_MIN_PX;
  readonly treePaneMaxPx = WCFM_TREE_PANE_MAX_PX;
  readonly treeSplitDragging = signal(false);

  readonly duplicateStrategy = signal<WhitecapDuplicateStrategy>('ask');
  readonly validationIssues = signal<WhitecapUploadValidationIssue[]>([]);
  readonly clipboardItems = signal<WhitecapFileItem[]>([]);
  readonly clipboardMode = signal<'copy' | 'cut' | null>(null);
  readonly contextMenu = signal<ContextMenuState | null>(null);
  readonly dialogAction = signal<DialogAction>(null);
  readonly dialogValue = signal<string>('');
  readonly expandedTreePaths = signal<Set<string>>(new Set(['/']));
  readonly treeRows = computed<TreeRow[]>(() => this.buildTreeRowsFor(this.expandedTreePaths(), true));

  readonly dialogExpandedPaths = signal<Set<string>>(new Set(['/']));
  readonly dialogSelectedPath = signal<string | null>(null);
  readonly dialogTreeRows = computed<TreeRow[]>(() => this.buildTreeRowsFor(this.dialogExpandedPaths(), false));
  readonly dialogPickerError = computed<string | null>(() => {
    const action = this.dialogAction();
    if (action !== 'move' && action !== 'copy') {
      return null;
    }
    const target = this.dialogSelectedPath();
    if (!target) {
      return 'Choose a destination folder.';
    }
    const sources = this.dialogSourceItems();
    for (const item of sources) {
      if (item.type === 'folder' && this.isAncestorOrSelf(item.path, target)) {
        return `Cannot ${action} "${item.name}" into itself or a subfolder.`;
      }
    }
    return null;
  });
  readonly treeSkeletonRows = [0, 1, 2, 3, 4, 5];
  readonly tableSkeletonRows = [0, 1, 2, 3, 4, 5, 6];
  readonly gridSkeletonCards = [0, 1, 2, 3, 4, 5, 6, 7];

  readonly allSelected = computed(() => {
    const items = this.store.items();
    if (!items.length) {
      return false;
    }
    const selected = this.store.selectedIds();
    return items.every((item) => selected.has(item.id));
  });

  readonly someSelected = computed(() => {
    const items = this.store.items();
    if (!items.length) {
      return false;
    }
    const selected = this.store.selectedIds();
    const count = items.reduce((acc, item) => acc + (selected.has(item.id) ? 1 : 0), 0);
    return count > 0 && count < items.length;
  });

  readonly icons = this.buildIcons();

  fileIconKind(item: WhitecapFileItem): FileIconKind {
    return resolveFileIconKind(item);
  }

  fileIconFor(item: WhitecapFileItem): SafeHtml {
    return this.fileTypeIcons[this.fileIconKind(item)];
  }

  readonly dropTargetPath = signal<string | null>(null);
  /** True while the user drags OS files/folders over the widget (upload drop zone). */
  readonly externalFileDragOver = signal(false);
  private draggingItemIds = signal<Set<string>>(new Set<string>());

  readonly filterOpen = signal<boolean>(false);
  readonly filterDraft = signal<{ fileTypes?: string; owner?: string; dateFrom?: string; dateTo?: string }>({});

  readonly previewPaneOpen = signal<boolean>(false);
  readonly showPreview = computed(() => this.previewPaneOpen());
  readonly previewLoading = signal<boolean>(false);
  readonly previewKind = signal<'image' | 'text' | 'pdf' | 'eml' | 'none'>('none');
  readonly previewImageUrl = signal<string | null>(null);
  readonly previewPdfUrl = signal<SafeResourceUrl | null>(null);
  readonly previewText = signal<string | null>(null);
  readonly emlHeaders = computed(() => {
    if (this.previewKind() !== 'eml') return [] as { key: string; value: string }[];
    return this.parseEmlHeaders(this.previewText());
  });
  private readonly emlParsed = computed(() => {
    if (this.previewKind() !== 'eml') return { isHtml: false, body: '' };
    return this.parseEmlContent(this.previewText());
  });
  readonly emlBody = computed(() => this.emlParsed().body);
  readonly emlBodyIsHtml = computed(() => this.emlParsed().isHtml);
  readonly emlBodySafeHtml = computed<SafeHtml | null>(() => {
    if (!this.emlBodyIsHtml()) return null;
    return this.sanitizer.bypassSecurityTrustHtml(this.emlBody());
  });
  readonly previewItem = computed<WhitecapFileItem | null>(() => {
    const selected = this.store.selectedItems();
    if (selected.length === 1 && selected[0].type === 'file') {
      return selected[0];
    }
    return null;
  });
  private readonly previewTrigger$ = new Subject<void>();
  private previewObjectUrl: string | null = null;

  readonly pageSizeOptions = [10, 25, 50, 100];
  readonly pageRangeStart = computed(() => {
    if (!this.store.total()) return 0;
    return this.store.pageIndex() * this.store.pageSize() + 1;
  });
  readonly pageRangeEnd = computed(() =>
    Math.min(this.store.total(), (this.store.pageIndex() + 1) * this.store.pageSize()),
  );

  private dialogItem: WhitecapFileItem | null = null;
  private lastBoundProvider: WhitecapStorageProvider | null = null;
  private lastBoundInitialPath: string | null = null;

  constructor() {
    effect(() => {
      const provider = this.provider();
      const initial = this.initialPath();
      const providerChanged = this.lastBoundProvider !== provider;
      const initialChanged = this.lastBoundInitialPath !== initial;

      if (!provider) {
        this.lastBoundProvider = null;
        this.lastBoundInitialPath = null;
        return;
      }

      // Only bind when the adapter instance changes. Calling `setProvider` on every effect pass
      // resets `flatFilesMode` and would clear the Show All Files / Show Folders toggle while a flat list response is still applied.
      if (providerChanged) {
        this.store.setProvider(provider);
        this.lastBoundProvider = provider;
      }

      if (providerChanged || initialChanged) {
        this.lastBoundInitialPath = initial;
        this.store.setPath(initial);
      }
    });

    effect(() => {
      this.duplicateStrategy.set(this.defaultDuplicateStrategy());
    });

    effect(() => {
      this.store.setPageSize(this.defaultPageSize());
    });

    effect(() => {
      this.store.setVisibleFileTypes(this.visibleFileTypes());
    });

    effect(() => {
      this.selectionChanged.emit(this.store.selectedItems());
    });

    effect(() => {
      const currentPath = this.store.currentPath();
      this.expandedTreePaths.update((existing) => {
        const next = new Set(existing);
        const segments = currentPath.split('/').filter(Boolean);
        let runningPath = '';
        next.add('/');
        for (const segment of segments) {
          runningPath = `${runningPath}/${segment}`.replace(/\/+/g, '/');
          next.add(runningPath);
        }
        return next;
      });
    });

    effect(() => {
      this.previewItem();
      this.showPreview();
      queueMicrotask(() => this.refreshPreview());
    });

    effect(() => {
      if (this.store.flatFilesMode()) {
        this.filterOpen.set(false);
        this.clearTreeSplitterDragListeners();
      }
    });

    this.previewTrigger$.pipe(
      switchMap(() => {
        this.releasePreview();
        const item = this.previewItem();
        if (!item || !this.showPreview()) {
          this.previewKind.set('none');
          return EMPTY;
        }
        const provider = this.provider();
        if (!provider?.preview) {
          this.previewKind.set('none');
          return EMPTY;
        }
        const ext = item.extension?.toLowerCase();
        const previewable = this.previewableExtensions();
        if (previewable && (!ext || !previewable.some((e) => e.replace(/^\./, '').toLowerCase() === ext))) {
          this.previewKind.set('none');
          return EMPTY;
        }
        this.previewLoading.set(true);
        return provider.preview(item).pipe(
          map((result) => ({ result, ext })),
          catchError(() => {
            this.previewKind.set('none');
            return EMPTY;
          }),
          finalize(() => this.previewLoading.set(false)),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe({
      next: ({ result, ext }) => {
        if (typeof result === 'string') {
          this.previewText.set(result);
          this.previewKind.set(ext === 'eml' ? 'eml' : 'text');
          return;
        }
        if (result.type.startsWith('image/')) {
          this.previewObjectUrl = URL.createObjectURL(result);
          this.previewImageUrl.set(this.previewObjectUrl);
          this.previewKind.set('image');
          return;
        }
        if (result.type === 'application/pdf' || ext === 'pdf') {
          this.previewObjectUrl = URL.createObjectURL(result);
          this.previewPdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.previewObjectUrl));
          this.previewKind.set('pdf');
          return;
        }
        const isEml = result.type === 'message/rfc822' || ext === 'eml';
        result
          .text()
          .then((text) => {
            this.previewText.set(text);
            this.previewKind.set(isEml ? 'eml' : 'text');
          })
          .catch(() => this.previewKind.set('none'));
      },
    });
  }

  ngOnDestroy(): void {
    this.clearTreeSplitterDragListeners();
    this.releasePreview();
  }

  ngOnInit(): void {
    this.previewPaneOpen.set(this.previewPaneVisible());
    this.store.refresh();
  }

  @HostListener('window:keydown.escape')
  onEscapePressed(): void {
    this.closeContextMenu();
    this.closeDialog();
    this.filterOpen.set(false);
  }

  @HostListener('window:keydown.delete', ['$event'])
  onDeleteKey(event: Event): void {
    if (this.isShortcutBlocked(event)) return;
    if (this.store.selectedItems().length) {
      this.openDialog('delete');
    }
  }

  @HostListener('window:keydown.F2', ['$event'])
  onF2Key(event: Event): void {
    if (this.isShortcutBlocked(event)) return;
    const selected = this.store.selectedItems();
    if (selected.length === 1) {
      this.openDialog('rename', selected[0]);
    }
  }

  @HostListener('window:keydown.enter', ['$event'])
  onEnterKey(event: Event): void {
    if (this.isShortcutBlocked(event)) return;
    const target = event.target as HTMLElement;
    // Item rows/cards already have their own (keydown.enter) binding — don't double-fire
    if (target.closest('.wcfm-row, .wcfm-card')) return;
    const selected = this.store.selectedItems();
    if (selected.length === 1) {
      this.openItem(selected[0]);
    }
  }

  @HostListener('window:keydown.control.c', ['$event'])
  onCopyKey(event: Event): void {
    if (this.isShortcutBlocked(event)) return;
    const selected = this.store.selectedItems();
    if (!selected.length) return;
    this.clipboardItems.set(selected);
    this.clipboardMode.set('copy');
    event.preventDefault();
  }

  @HostListener('window:keydown.control.x', ['$event'])
  onCutKey(event: Event): void {
    if (this.isShortcutBlocked(event)) return;
    const selected = this.store.selectedItems();
    if (!selected.length) return;
    this.clipboardItems.set(selected);
    this.clipboardMode.set('cut');
    event.preventDefault();
  }

  @HostListener('window:keydown.control.v', ['$event'])
  onPasteKey(event: Event): void {
    if (this.isShortcutBlocked(event)) return;
    const items = this.clipboardItems();
    const mode = this.clipboardMode();
    if (!items.length || !mode) return;
    const targetPath = this.store.currentPath();
    const previousSelection = this.store.selectedIds();
    this.store.selectedIds.set(new Set(items.map((i) => i.id)));
    if (mode === 'cut') {
      this.store.moveSelected(targetPath, () => this.fileMoved.emit(targetPath));
      this.clipboardItems.set([]);
      this.clipboardMode.set(null);
    } else {
      this.store.copySelected(targetPath, () => this.fileCopied.emit(targetPath));
    }
    this.store.selectedIds.set(previousSelection);
    event.preventDefault();
  }

  private isShortcutBlocked(event: Event): boolean {
    if (!this.hostEl.nativeElement.contains(event.target as Node)) return true;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
    if (this.dialogAction() || this.contextMenu()) return true;
    return false;
  }

  onSurfaceClick(): void {
    this.closeContextMenu();
    this.filterOpen.set(false);
  }

  onTreeSplitterPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (this.treeSplitterMoveListener) {
      this.clearTreeSplitterDragListeners();
    }
    const startX = event.clientX;
    const startW = this.treePaneWidthPx();
    const rtl = getComputedStyle(this.hostEl.nativeElement).direction === 'rtl';
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture?.(event.pointerId);

    const move = (ev: PointerEvent) => {
      const dx = rtl ? startX - ev.clientX : ev.clientX - startX;
      const next = Math.min(
        WCFM_TREE_PANE_MAX_PX,
        Math.max(WCFM_TREE_PANE_MIN_PX, Math.round(startW + dx)),
      );
      this.treePaneWidthPx.set(next);
    };
    const up = (_ev: PointerEvent) => {
      this.clearTreeSplitterDragListeners();
      try {
        target?.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
    };

    this.treeSplitterMoveListener = move;
    this.treeSplitterUpListener = up;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    this.treeSplitDragging.set(true);
  }

  onTreeSplitterKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    const rtl = getComputedStyle(this.hostEl.nativeElement).direction === 'rtl';
    const widenKey = rtl ? 'ArrowLeft' : 'ArrowRight';
    const delta = event.shiftKey ? 40 : 16;
    const next =
      this.treePaneWidthPx() + (event.key === widenKey ? delta : -delta);
    this.treePaneWidthPx.set(
      Math.min(WCFM_TREE_PANE_MAX_PX, Math.max(WCFM_TREE_PANE_MIN_PX, next)),
    );
    event.preventDefault();
  }

  private clearTreeSplitterDragListeners(): void {
    if (this.treeSplitterMoveListener) {
      document.removeEventListener('pointermove', this.treeSplitterMoveListener);
      this.treeSplitterMoveListener = null;
    }
    if (this.treeSplitterUpListener) {
      document.removeEventListener('pointerup', this.treeSplitterUpListener);
      document.removeEventListener('pointercancel', this.treeSplitterUpListener);
      this.treeSplitterUpListener = null;
    }
    this.treeSplitDragging.set(false);
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.store.setSearch(target.value);
  }

  togglePreviewPane(): void {
    this.previewPaneOpen.update((v) => !v);
  }

  toggleFlatFilesMode(): void {
    const enabling = !this.store.flatFilesMode();
    const pathBefore = this.store.currentPath();
    this.store.setFlatFilesMode(enabling);
    if (enabling && pathBefore !== this.store.currentPath()) {
      this.folderChanged.emit(this.store.currentPath());
    }
  }

  openTreePath(path: string): void {
    this.store.setPath(path);
    this.folderChanged.emit(path);
  }

  toggleTreeFolder(path: string): void {
    this.expandedTreePaths.update((existing) => {
      const next = new Set(existing);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  onItemRowClick(item: WhitecapFileItem, event: MouseEvent): void {
    this.closeContextMenu();
    if (!event.ctrlKey && !event.metaKey) {
      this.store.clearSelection();
    }

    this.store.toggleSelection(item);
  }

  toggleSingleItemSelection(item: WhitecapFileItem, event: Event): void {
    event.preventDefault();
    this.store.clearSelection();
    this.store.toggleSelection(item);
  }

  onItemMenuClick(item: WhitecapFileItem, event: MouseEvent): void {
    event.stopPropagation();
    this.contextMenu.set({ x: event.clientX - 12, y: event.clientY - 12, item });
  }

  onItemContextMenu(item: WhitecapFileItem, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.store.selectedIds().has(item.id)) {
      this.store.clearSelection();
      this.store.toggleSelection(item);
    }
    this.contextMenu.set({ x: event.clientX - 12, y: event.clientY - 12, item });
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  onContextAction(action: ContextAction): void {
    const menu = this.contextMenu();
    this.closeContextMenu();
    if (!menu) {
      return;
    }

    if (!this.store.selectedIds().has(menu.item.id)) {
      this.store.clearSelection();
      this.store.toggleSelection(menu.item);
    }

    if (action === 'open') {
      this.openItem(menu.item);
      return;
    }

    if (action === 'rename' || action === 'move' || action === 'copy' || action === 'delete') {
      this.openDialog(action, menu.item);
      return;
    }

    if (action === 'download') {
      this.store.downloadSelected((fileName, blob) => this.downloadBlob(fileName, blob));
      return;
    }

    this.actionTriggered.emit({ actionId: action, items: this.store.selectedItems() });
  }

  contextActionLabel(action: ContextAction): string {
    const builtIn: Record<string, string> = {
      open: 'Open',
      rename: 'Rename',
      move: 'Move',
      copy: 'Copy',
      download: 'Download',
      delete: 'Delete',
    };
    return builtIn[action] ?? this.actions().find((a) => a.id === action)?.label ?? action;
  }

  openItem(item: WhitecapFileItem): void {
    if (item.type === 'folder') {
      const target = resolveFolderNavigatePath(item, this.store.currentPath());
      this.store.setPath(target);
      this.folderChanged.emit(target);
      return;
    }
    this.fileOpened.emit(item);
  }

  onUploadInput(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    const files = Array.from(inputElement.files ?? []);
    const specs: WhitecapUploadFileSpec[] = files.map((file) => {
      const wk = (file as File & { webkitRelativePath?: string }).webkitRelativePath
        ?.replace(/\\/g, '/')
        ?.replace(/^\/+/, '')
        ?.trim();
      return { file, relativePath: wk || undefined };
    });
    this.startUpload(specs);
    inputElement.value = '';
  }

  onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types?.includes(WCFM_DRAG_MIME)) {
      return;
    }
    event.preventDefault();
    if (this.hasExternalFileDragPayload(event.dataTransfer)) {
      this.externalFileDragOver.set(true);
    }
  }

  onExplorerDragEnter(event: DragEvent): void {
    if (event.dataTransfer?.types?.includes(WCFM_DRAG_MIME)) {
      return;
    }
    if (!this.hasExternalFileDragPayload(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    this.externalFileDragOver.set(true);
  }

  onExplorerDragLeave(event: DragEvent): void {
    const root = event.currentTarget as HTMLElement | null;
    const related = event.relatedTarget as Node | null;
    if (root && related && root.contains(related)) {
      return;
    }
    this.externalFileDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    if (event.dataTransfer?.types?.includes(WCFM_DRAG_MIME)) {
      return;
    }
    event.preventDefault();
    this.externalFileDragOver.set(false);
    const dt = event.dataTransfer;
    if (!dt) {
      return;
    }
    void this.collectOsDropFiles(dt).then((specs) => this.startUpload(specs));
  }

  /**
   * OS drag-and-drop: read files from `DataTransferItem` + directory traversal when available.
   * Relying on `dataTransfer.files` alone is unreliable for dropped folders (see web.dev drag-and-drop directories).
   */
  private async collectOsDropFiles(dt: DataTransfer): Promise<WhitecapUploadFileSpec[]> {
    const fromFileList = (): WhitecapUploadFileSpec[] =>
      Array.from(dt.files ?? []).map((file) => {
        const wk = (file as File & { webkitRelativePath?: string }).webkitRelativePath
          ?.replace(/\\/g, '/')
          ?.replace(/^\/+/, '')
          ?.trim();
        return { file, relativePath: wk || undefined };
      });
    const items = dt.items ? Array.from(dt.items) : [];
    const canTraverse =
      items.length > 0 &&
      typeof DataTransferItem !== 'undefined' &&
      'webkitGetAsEntry' in DataTransferItem.prototype;

    if (!canTraverse) {
      return fromFileList();
    }

    try {
      const fromEntries = await this.collectSpecsFromDataTransferItems(items);
      return fromEntries.length > 0 ? fromEntries : fromFileList();
    } catch {
      return fromFileList();
    }
  }

  private async collectSpecsFromDataTransferItems(items: DataTransferItem[]): Promise<WhitecapUploadFileSpec[]> {
    const out: WhitecapUploadFileSpec[] = [];
    for (const item of items) {
      if (item.kind !== 'file') {
        continue;
      }
      const entry = item.webkitGetAsEntry?.() ?? null;
      if (!entry) {
        continue;
      }
      out.push(...(await this.collectSpecsFromFileSystemEntry(entry, '')));
    }
    return out;
  }

  private async collectSpecsFromFileSystemEntry(
    entry: FileSystemEntry,
    pathPrefix: string,
  ): Promise<WhitecapUploadFileSpec[]> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      const rel = pathPrefix ? `${pathPrefix}${entry.name}` : undefined;
      return [{ file, relativePath: rel }];
    }
    if (entry.isDirectory) {
      return this.readDroppedDirectoryTree(entry as FileSystemDirectoryEntry, `${pathPrefix}${entry.name}/`);
    }
    return [];
  }

  private readDirectoryEntriesBatched(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
    const reader = dir.createReader();
    return new Promise((resolve, reject) => {
      const acc: FileSystemEntry[] = [];
      const step = (): void => {
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) {
              resolve(acc);
              return;
            }
            acc.push(...batch);
            step();
          },
          reject,
        );
      };
      step();
    });
  }

  private async readDroppedDirectoryTree(
    dir: FileSystemDirectoryEntry,
    pathPrefix: string,
  ): Promise<WhitecapUploadFileSpec[]> {
    const entries = await this.readDirectoryEntriesBatched(dir);
    const out: WhitecapUploadFileSpec[] = [];
    for (const child of entries) {
      out.push(...(await this.collectSpecsFromFileSystemEntry(child, pathPrefix)));
    }
    return out;
  }

  onItemDragStart(item: WhitecapFileItem, event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }
    const selected = this.store.selectedIds();
    const ids = selected.has(item.id) ? Array.from(selected) : [item.id];
    event.dataTransfer.setData(WCFM_DRAG_MIME, JSON.stringify(ids));
    event.dataTransfer.effectAllowed = 'move';
    this.draggingItemIds.set(new Set(ids));
  }

  onItemDragEnd(): void {
    this.draggingItemIds.set(new Set<string>());
    this.dropTargetPath.set(null);
  }

  onFolderDragOver(targetPath: string, event: DragEvent): void {
    if (!event.dataTransfer?.types?.includes(WCFM_DRAG_MIME)) {
      return;
    }
    if (!this.canDropOn(targetPath)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    if (this.dropTargetPath() !== targetPath) {
      this.dropTargetPath.set(targetPath);
    }
  }

  onFolderDragLeave(targetPath: string): void {
    if (this.dropTargetPath() === targetPath) {
      this.dropTargetPath.set(null);
    }
  }

  onFolderDrop(targetPath: string, event: DragEvent): void {
    if (!event.dataTransfer?.types?.includes(WCFM_DRAG_MIME)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.dropTargetPath.set(null);

    if (!this.canDropOn(targetPath)) {
      return;
    }

    let ids: string[] = [];
    try {
      ids = JSON.parse(event.dataTransfer.getData(WCFM_DRAG_MIME) || '[]');
    } catch {
      return;
    }
    if (!ids.length) {
      return;
    }

    const items = this.store.items().filter((entry) => ids.includes(entry.id));
    if (!items.length) {
      return;
    }

    if (items.some((entry) => entry.type === 'folder' && this.isAncestorOrSelf(entry.path, targetPath))) {
      this.store.showToast('move', 'Cannot move a folder into itself.', 'error');
      return;
    }

    if (items.every((entry) => (entry.parentPath ?? '/') === targetPath)) {
      return;
    }

    const previousSelection = this.store.selectedIds();
    this.store.selectedIds.set(new Set(ids));
    this.store.moveSelected(targetPath, () => this.fileMoved.emit(targetPath));
    this.store.selectedIds.set(previousSelection);
  }

  private canDropOn(targetPath: string): boolean {
    const draggingIds = this.draggingItemIds();
    if (!draggingIds.size) {
      return true;
    }
    const draggingPaths = this.store
      .items()
      .filter((entry) => draggingIds.has(entry.id))
      .map((entry) => entry.path);
    return !draggingPaths.some((path) => this.isAncestorOrSelf(path, targetPath));
  }

  private hasExternalFileDragPayload(dt: DataTransfer | null): boolean {
    if (!dt?.types?.length) {
      return false;
    }
    return Array.from(dt.types as Iterable<string>).includes('Files');
  }

  private isAncestorOrSelf(folderPath: string, candidate: string): boolean {
    if (folderPath === candidate) {
      return true;
    }
    const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
    return candidate.startsWith(prefix);
  }

  triggerFileUpload(): void {
    this.fileUploadInput()?.nativeElement.click();
  }

  triggerFolderUpload(): void {
    this.folderUploadInput()?.nativeElement.click();
  }

  executeToolbarAction(actionId: string): void {
    this.closeContextMenu();

    if (actionId === 'refresh') {
      this.store.hardRefresh();
      return;
    }

    if (actionId === 'new-folder') {
      this.openDialog('new-folder');
      return;
    }

    if (actionId === 'upload') {
      this.triggerFileUpload();
      return;
    }

    if (actionId === 'delete') {
      if (!this.store.selectedItems().length) {
        return;
      }
      this.openDialog('delete');
      return;
    }

    if (actionId === 'rename') {
      const item = this.store.selectedItems()[0];
      if (!item) {
        return;
      }
      this.openDialog('rename', item);
      return;
    }

    if (actionId === 'move' || actionId === 'copy') {
      if (!this.store.selectedItems().length) {
        return;
      }
      this.openDialog(actionId);
      return;
    }

    if (actionId === 'download') {
      this.store.downloadSelected((fileName, blob) => this.downloadBlob(fileName, blob));
      return;
    }

    this.actionTriggered.emit({ actionId, items: this.store.selectedItems() });
  }

  isActionDisabled(actionId: string): boolean {
    const selected = this.store.selectedItems();
    if (actionId === 'rename') {
      if (selected.length !== 1) return true;
      return selected[0].permissions?.canRename === false;
    }

    if (actionId === 'download') {
      if (selected.length !== 1 || selected[0].type !== 'file') return true;
      return selected[0].permissions?.canDownload === false;
    }

    if (actionId === 'move') {
      if (selected.length < 1) return true;
      return selected.some((item) => item.permissions?.canMove === false);
    }

    if (actionId === 'copy' || actionId === 'delete') {
      if (selected.length < 1) return true;
      if (actionId === 'delete') {
        return selected.some((item) => item.permissions?.canDelete === false);
      }
      return false;
    }

    const action = this.actions().find((a) => a.id === actionId);
    if (action?.requiresSelection) {
      return selected.length < 1;
    }

    return false;
  }

  isContextActionDisabled(action: ContextAction, item: WhitecapFileItem): boolean {
    const effectiveItems = this.store.selectedIds().has(item.id) ? this.store.selectedItems() : [item];

    if (action === 'download') {
      if (effectiveItems.length !== 1 || effectiveItems[0].type !== 'file') return true;
      return effectiveItems[0].permissions?.canDownload === false;
    }

    if (action === 'rename') {
      return item.permissions?.canRename === false;
    }

    if (action === 'delete') {
      return effectiveItems.some((i) => i.permissions?.canDelete === false);
    }

    if (action === 'move') {
      return effectiveItems.some((i) => i.permissions?.canMove === false);
    }

    return false;
  }

  toolbarIcon(actionId: string): string {
    const icons: Record<string, string> = {
      refresh: '↻',
      'new-folder': '+',
      upload: '↑',
      move: '→',
      copy: '⧉',
      rename: '✎',
      delete: '⌫',
      download: '↓',
    };

    return icons[actionId] ?? '•';
  }

  iconFor(actionId: string): SafeHtml {
    const map: Record<string, SafeHtml> = {
      refresh: this.icons.refresh,
      'new-folder': this.icons.newFolder,
      upload: this.icons.upload,
      move: this.icons.move,
      copy: this.icons.copy,
      rename: this.icons.rename,
      delete: this.icons.delete,
      download: this.icons.download,
    };
    if (map[actionId]) return map[actionId];
    const customIcon = this.actions().find((a) => a.id === actionId)?.icon;
    if (customIcon) return this.sanitizer.bypassSecurityTrustHtml(customIcon);
    return this.icons.dot;
  }

  /** Opens the filter panel (no-op in flat file list mode). Call from host UI if you removed the built-in filter control. */
  openFilterPanel(): void {
    if (this.store.flatFilesMode()) {
      return;
    }
    const current = this.store.filters();
    this.filterDraft.set({
      fileTypes: current.fileTypes?.join(', '),
      owner: current.owner,
      dateFrom: current.dateFrom,
      dateTo: current.dateTo,
    });
    this.filterOpen.set(true);
  }

  onFilterDraftChange(field: 'fileTypes' | 'owner' | 'dateFrom' | 'dateTo', event: Event): void {
    const target = event.target as HTMLInputElement;
    this.filterDraft.update((current) => ({ ...current, [field]: target.value }));
  }

  applyFilters(): void {
    const draft = this.filterDraft();
    const fileTypes = (draft.fileTypes ?? '')
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const next: WhitecapFilters = {};
    if (fileTypes.length) next.fileTypes = fileTypes;
    if (draft.owner?.trim()) next.owner = draft.owner.trim();
    if (draft.dateFrom) next.dateFrom = draft.dateFrom;
    if (draft.dateTo) next.dateTo = draft.dateTo;
    this.store.setFilters(next);
    this.filterOpen.set(false);
  }

  clearFilters(): void {
    this.filterDraft.set({});
    this.store.clearFilters();
    this.filterOpen.set(false);
  }

  goToFirstPage(): void {
    this.store.setPage(0);
  }

  goToLastPage(): void {
    this.store.setPage(this.store.pageCount() - 1);
  }

  goToPrevPage(): void {
    this.store.setPage(this.store.pageIndex() - 1);
  }

  goToNextPage(): void {
    this.store.setPage(this.store.pageIndex() + 1);
  }

  private refreshPreview(): void {
    this.previewTrigger$.next();
  }

  private releasePreview(): void {
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
    this.previewImageUrl.set(null);
    this.previewPdfUrl.set(null);
    this.previewText.set(null);
  }

  private parseEmlHeaders(text: string | null): { key: string; value: string }[] {
    if (!text) return [];
    const displayed = ['from', 'to', 'cc', 'bcc', 'subject', 'date', 'reply-to'];
    const headerSection = text.split(/\r?\n\r?\n/)[0] ?? '';
    // Unfold folded header lines (RFC 2822: continuation lines start with whitespace)
    const unfolded: string[] = [];
    for (const line of headerSection.split(/\r?\n/)) {
      if (/^\s/.test(line) && unfolded.length > 0) {
        unfolded[unfolded.length - 1] += ' ' + line.trim();
      } else {
        unfolded.push(line);
      }
    }
    return unfolded
      .filter((line) => {
        const colon = line.indexOf(':');
        return colon > 0 && displayed.includes(line.slice(0, colon).trim().toLowerCase());
      })
      .map((line) => {
        const colon = line.indexOf(':');
        return { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
      });
  }

  private parseEmlContent(text: string | null): { isHtml: boolean; body: string } {
    if (!text) return { isHtml: false, body: '' };
    const sections = text.split(/\r?\n\r?\n/);
    const headerSection = sections[0] ?? '';
    const rawBody = sections.slice(1).join('\n\n');
    const contentType = this.extractEmlHeader(headerSection, 'content-type') ?? '';
    if (/multipart\//i.test(contentType)) {
      const boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1];
        const html = this.findMultipartPart(rawBody, boundary, 'text/html');
        if (html != null) return { isHtml: true, body: html };
        const plain = this.findMultipartPart(rawBody, boundary, 'text/plain');
        if (plain != null) return { isHtml: false, body: plain };
      }
    }
    if (/text\/html/i.test(contentType)) return { isHtml: true, body: rawBody.trim() };
    return { isHtml: false, body: rawBody.trim() };
  }

  private findMultipartPart(body: string, boundary: string, mimeType: string): string | null {
    const parts = body.split('--' + boundary);
    for (const part of parts) {
      const split = part.split(/\r?\n\r?\n/);
      const partHeaders = split[0] ?? '';
      const partBody = split.slice(1).join('\n\n');
      const ct = this.extractEmlHeader(partHeaders, 'content-type') ?? '';
      if (new RegExp(mimeType, 'i').test(ct)) return partBody.trim();
    }
    return null;
  }

  private extractEmlHeader(headers: string, name: string): string | null {
    const regex = new RegExp(`^${name}:\\s*(.+(?:\\r?\\n[ \\t].+)*)`, 'im');
    const match = headers.match(regex);
    return match ? match[1].replace(/\r?\n[ \t]+/g, ' ').trim() : null;
  }

  onSelectAllChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.store.clearSelection();
    if (target.checked) {
      for (const item of this.store.items()) {
        this.store.toggleSelection(item);
      }
    }
  }

  onCheckboxClick(item: WhitecapFileItem, event: MouseEvent): void {
    event.stopPropagation();
    this.store.toggleSelection(item);
  }

  private buildIcons() {
    const safe = (svg: string): SafeHtml => this.sanitizer.bypassSecurityTrustHtml(svg);
    const stroke = (path: string): string =>
      `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${path}</svg>`;
    const filled = (path: string): string =>
      `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${path}</svg>`;

    return {
      refresh: safe(stroke('<path d="M13.5 3.5v3h-3"/><path d="M2.5 12.5v-3h3"/><path d="M3.6 7a5 5 0 0 1 8.4-1.5L13.5 7"/><path d="M12.4 9a5 5 0 0 1-8.4 1.5L2.5 9"/>')),
      newFolder: safe(stroke('<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.379a1.5 1.5 0 0 1 1.06.44L8 4.5h4.5A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5Z"/><path d="M8 8v3"/><path d="M6.5 9.5h3"/>')),
      upload: safe(stroke('<path d="M8 10.5V3"/><path d="M5 6l3-3 3 3"/><path d="M3 11.5v1A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-1"/>')),
      uploadFolder: safe(stroke('<path d="M2 5A1.5 1.5 0 0 1 3.5 3.5h2.379a1.5 1.5 0 0 1 1.06.44L8 5h4.5A1.5 1.5 0 0 1 14 6.5v6A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5V5Z"/><path d="M8 11.5V7.5"/><path d="M6 9.5l2-2 2 2"/>')),
      move: safe(stroke('<path d="M3 8h10"/><path d="M9 4l4 4-4 4"/>')),
      copy: safe(stroke('<rect x="5" y="5" width="8.5" height="8.5" rx="1.2"/><path d="M3 10.5V3.5A1.5 1.5 0 0 1 4.5 2h7"/>')),
      rename: safe(stroke('<path d="M11.5 2.5l2 2-7.5 7.5H4v-2L11.5 2.5Z"/><path d="M10.5 3.5l2 2"/>')),
      delete: safe(stroke('<path d="M3 4.5h10"/><path d="M5 4.5V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5"/><path d="M4.5 4.5l.6 8a1.5 1.5 0 0 0 1.5 1.4h2.8a1.5 1.5 0 0 0 1.5-1.4l.6-8"/><path d="M7 7v4"/><path d="M9 7v4"/>')),
      download: safe(stroke('<path d="M8 3v8"/><path d="M5 8l3 3 3-3"/><path d="M3 13.5h10"/>')),
      list: safe(stroke('<path d="M3 4.5h10"/><path d="M3 8h10"/><path d="M3 11.5h10"/>')),
      flatFiles: safe(
        stroke(
          '<path d="M2.5 4.5h7.5"/><path d="M2.5 8h7.5"/><path d="M2.5 11.5h4.5"/><path d="M12.5 3.5V11"/><path d="M11 11.5l1.5 1.5 1.5-1.5"/>',
        ),
      ),
      grid: safe(stroke('<rect x="3" y="3" width="4" height="4" rx="0.5"/><rect x="9" y="3" width="4" height="4" rx="0.5"/><rect x="3" y="9" width="4" height="4" rx="0.5"/><rect x="9" y="9" width="4" height="4" rx="0.5"/>')),
      previewPane: safe(stroke('<rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M9.5 3.5V12.5"/>')),
      search: safe(stroke('<circle cx="7" cy="7" r="4"/><path d="M10 10l3 3"/>')),
      chevRight: safe(stroke('<path d="M6 4l4 4-4 4"/>')),
      chevDown: safe(stroke('<path d="M4 6l4 4 4-4"/>')),
      folderBrand: safe(BRAND_FILE_TYPE_SVGS.folder),
      dot: safe(stroke('<circle cx="8" cy="8" r="1"/>')),
      toastSuccess: safe(stroke('<circle cx="8" cy="8" r="5.5"/><path d="M5.5 8l2 2.5 3-4"/>')),
      toastError: safe(stroke('<circle cx="8" cy="8" r="5.5"/><path d="M6 6l4 4M10 6l-4 4"/>')),
    };
  }

  sortIndicator(field: WhitecapSortField): string {
    if (this.store.sortBy() !== field) {
      return '↕';
    }

    return this.store.sortDirection() === 'asc' ? '↑' : '↓';
  }

  openDialog(action: Exclude<DialogAction, null>, item?: WhitecapFileItem): void {
    this.dialogAction.set(action);
    this.dialogItem = item ?? null;
    if (action === 'rename' && item) {
      this.dialogValue.set(item.name);
    } else if (action === 'move' || action === 'copy') {
      this.seedDialogPicker(action);
      this.dialogValue.set('');
    } else {
      this.dialogValue.set('');
    }

    if (action !== 'move' && action !== 'copy') {
      queueMicrotask(() => this.dialogInput()?.nativeElement.focus());
    }
  }

  private seedDialogPicker(action: 'move' | 'copy'): void {
    const sources = this.dialogSourceItems();
    const sourceParents = new Set(sources.map((item) => item.parentPath ?? '/'));
    const expanded = new Set<string>(['/']);
    const currentPath = this.store.currentPath();
    let running = '';
    for (const segment of currentPath.split('/').filter(Boolean)) {
      running = `${running}/${segment}`.replace(/\/+/g, '/');
      expanded.add(running);
    }
    this.dialogExpandedPaths.set(expanded);

    let initial: string | null = null;
    if (sourceParents.size === 1) {
      const onlyParent = [...sourceParents][0];
      initial = onlyParent === currentPath && action === 'move' ? null : onlyParent;
    }
    if (!initial && currentPath !== '/' && !sourceParents.has(currentPath)) {
      initial = currentPath;
    }
    this.dialogSelectedPath.set(initial);
  }

  dialogSourceItems(): WhitecapFileItem[] {
    if (this.dialogItem && !this.store.selectedIds().has(this.dialogItem.id)) {
      return [this.dialogItem];
    }
    return this.store.selectedItems();
  }

  setDialogPath(path: string): void {
    this.dialogSelectedPath.set(path);
  }

  toggleDialogFolder(path: string): void {
    this.dialogExpandedPaths.update((existing) => {
      const next = new Set(existing);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  isInvalidDialogTarget(path: string): boolean {
    const sources = this.dialogSourceItems();
    return sources.some((item) => item.type === 'folder' && this.isAncestorOrSelf(item.path, path));
  }

  isConfirmDisabled(): boolean {
    const action = this.dialogAction();
    if (action === 'move' || action === 'copy') {
      return this.dialogPickerError() !== null;
    }
    if (action === 'new-folder' || action === 'rename') {
      return !this.dialogValue().trim();
    }
    return false;
  }

  closeDialog(): void {
    this.dialogAction.set(null);
    this.dialogValue.set('');
    this.dialogSelectedPath.set(null);
    this.dialogItem = null;
  }

  pathBreadcrumbLabels(path: string): string[] {
    const p = normalizePath(path);
    if (p === '/') {
      return ['Root'];
    }
    const parts = p.split('/').filter(Boolean);
    return ['Root', ...parts];
  }

  dialogPickerDestinationAria(): string {
    const p = this.dialogSelectedPath();
    if (!p) {
      return 'Destination folder: not selected';
    }
    return `Destination folder: ${p}`;
  }

  dialogTitle(action: Exclude<DialogAction, null>): string {
    const titles: Record<Exclude<DialogAction, null>, string> = {
      'new-folder': 'Create Folder',
      rename: 'Rename Item',
      move: 'Move Items',
      copy: 'Copy Items',
      delete: 'Confirm Delete',
    };
    return titles[action];
  }

  dialogInputLabel(action: Exclude<DialogAction, null>): string {
    const labels: Record<Exclude<DialogAction, null>, string> = {
      'new-folder': 'Folder Name',
      rename: 'New Name',
      move: 'Target Path',
      copy: 'Target Path',
      delete: 'Value',
    };
    return labels[action];
  }

  dialogPlaceholder(action: Exclude<DialogAction, null>): string {
    const placeholders: Record<Exclude<DialogAction, null>, string> = {
      'new-folder': 'docs…',
      rename: 'new-name…',
      move: '/destination…',
      copy: '/destination…',
      delete: '',
    };
    return placeholders[action];
  }

  onDialogInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.dialogValue.set(target.value);
  }

  confirmDialog(): void {
    const action = this.dialogAction();
    if (!action) {
      return;
    }

    if (action === 'new-folder') {
      if (this.dialogValue().trim()) {
        this.store.createFolder(this.dialogValue().trim(), (result) => {
          if (result.data) {
            this.fileCreated.emit(result.data);
          }
        });
      }
      this.closeDialog();
      return;
    }

    if (action === 'rename') {
      const item = this.dialogItem ?? this.store.selectedItems()[0];
      const value = this.dialogValue().trim();
      if (item && value) {
        this.store.renameItem(item, value, (result) => {
          if (result.data) {
            this.fileRenamed.emit(result.data);
          }
        });
      }
      this.closeDialog();
      return;
    }

    if (action === 'move' || action === 'copy') {
      if (this.dialogPickerError()) {
        return;
      }
      const targetPath = this.dialogSelectedPath();
      if (!targetPath) {
        return;
      }
      const sources = this.dialogSourceItems();
      const previousSelection = this.store.selectedIds();
      this.store.selectedIds.set(new Set(sources.map((item) => item.id)));
      if (action === 'move') {
        this.store.moveSelected(targetPath, () => this.fileMoved.emit(targetPath));
      } else {
        this.store.copySelected(targetPath, () => this.fileCopied.emit(targetPath));
      }
      this.store.selectedIds.set(previousSelection);
      this.closeDialog();
      return;
    }

    if (action === 'delete') {
      const deletedIds = this.store.selectedItems().map((item) => item.id);
      this.store.deleteSelected(() => {
        this.fileDeleted.emit(deletedIds);
      });
      this.closeDialog();
    }
  }

  formatSize(size?: number): string {
    if (size === undefined) {
      return '—';
    }
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(size / 1024)} KB`;
  }

  /** Byte size for upload rows (matches small-file display like `1005 B`). */
  formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '—';
    }
    if (bytes < 1024) {
      return `${Math.round(bytes)} B`;
    }
    const kb = bytes / 1024;
    if (kb < 1024) {
      return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
    }
    const mb = kb / 1024;
    if (mb < 1024) {
      return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
    }
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  uploadBarPercent(entry: WhitecapUploadProgress): number {
    if (entry.status === 'completed' || entry.status === 'failed') {
      return 100;
    }
    return Math.min(100, Math.max(0, entry.percent));
  }

  formatDate(input?: string): string {
    if (!input) {
      return '—';
    }
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(input));
  }

  /** Parent directory path for flat file rows (breadcrumb-style). */
  parentFolderPath(item: WhitecapFileItem): string {
    return normalizePath(item.parentPath ?? '/');
  }


  private startUpload(specs: WhitecapUploadFileSpec[]): void {
    if (!specs.length) {
      return;
    }

    const [accepted, rejected] = this.filterUploadFiles(specs);
    this.validationIssues.set(rejected);

    if (!accepted.length) {
      return;
    }

    this.uploadStarted.emit(accepted.length);
    const inputs: WhitecapUploadFileInput[] = accepted.map((s) => s);
    this.store.uploadWithStrategy(inputs, this.resolveDuplicateStrategy(), (progress) => {
      if (progress.status === 'completed') {
        this.uploadCompleted.emit(progress);
      }
      if (progress.status === 'failed') {
        this.uploadFailed.emit(progress);
      }
    });
  }

  private resolveDuplicateStrategy(): WhitecapDuplicateStrategy {
    const strategy = this.duplicateStrategy();
    if (strategy !== 'ask') {
      return strategy;
    }

    const decision = window.prompt('Duplicate found. Choose strategy: replace | rename | skip', 'rename');
    if (decision === 'replace' || decision === 'rename' || decision === 'skip') {
      return decision;
    }
    return 'rename';
  }

  private filterUploadFiles(specs: WhitecapUploadFileSpec[]): [WhitecapUploadFileSpec[], WhitecapUploadValidationIssue[]] {
    const accepted: WhitecapUploadFileSpec[] = [];
    const rejected: WhitecapUploadValidationIssue[] = [];
    const config = this.uploadValidation();

    for (const spec of specs) {
      const logicalName =
        spec.relativePath?.split('/').filter(Boolean).pop() ?? spec.file.name;
      const issue = this.validateFile(spec.file, config, logicalName);
      if (issue) {
        const label = spec.relativePath?.replace(/\\/g, '/') ?? spec.file.name;
        rejected.push({ fileName: label, error: issue });
      } else {
        accepted.push(spec);
      }
    }

    return [accepted, rejected];
  }

  clearValidationIssues(): void {
    this.validationIssues.set([]);
  }

  private validateFile(
    file: File,
    config: WhitecapUploadValidationConfig | null,
    extensionSourceName = file.name,
  ): WhitecapOperationError | null {
    if (!config) {
      return null;
    }

    if (config.maxFileSizeBytes !== undefined && file.size > config.maxFileSizeBytes) {
      const mb = Math.max(1, Math.floor(config.maxFileSizeBytes / 1024 / 1024));
      return {
        code: 'max_file_size_exceeded',
        message: `This file is over the ${mb} MB limit. Choose a smaller file or compress it, then try again.`,
      };
    }

    if (config.acceptedMimeTypes?.length) {
      if (!file.type || !config.acceptedMimeTypes.includes(file.type)) {
        const preview = this.formatMimeTypesForHint(config.acceptedMimeTypes);
        return {
          code: 'invalid_mime_type',
          message: file.type
            ? `That file type isn’t on the allow list. Pick a file that matches one of these types: ${preview}.`
            : `This file doesn’t report a MIME type, so it can’t be checked. Pick a different file or convert to one of: ${preview}.`,
        };
      }
    }

    if (config.acceptedExtensions?.length) {
      const allowed = config.acceptedExtensions.map((entry) => entry.toLowerCase());
      const allowedStr = this.formatAllowedExtensionsForHint(allowed);
      let extension = this.uploadExtensionFromFileName(extensionSourceName);
      if (!extension && file.type) {
        extension = this.uploadInferExtensionFromMime(file.type.trim().toLowerCase()) ?? '';
      }
      if (!extension) {
        return {
          code: 'invalid_extension',
          message: `Add a file name with an allowed extension. You can use: ${allowedStr}.`,
        };
      }
      if (!this.uploadIsExtensionAllowed(extension, allowed)) {
        return {
          code: 'invalid_extension',
          message: `That extension isn’t on the allow list. Rename or export a copy using one of: ${allowedStr}.`,
        };
      }
    }

    return config.validator?.(file) ?? null;
  }

  /** Basename last segment after `.` (e.g. `a.tar.gz` → `.gz`, `icons` → ``). */
  private uploadExtensionFromFileName(fileName: string): string {
    const base = fileName.split(/[/\\]/).pop() ?? fileName;
    const i = base.lastIndexOf('.');
    if (i <= 0 || i === base.length - 1) {
      return '';
    }
    return base.slice(i).toLowerCase();
  }

  private uploadInferExtensionFromMime(mime: string): string | null {
    if (!mime) {
      return null;
    }
    return UPLOAD_MIME_TO_EXTENSION[mime] ?? null;
  }

  private uploadIsExtensionAllowed(extension: string, allowed: string[]): boolean {
    if (allowed.includes(extension)) {
      return true;
    }
    if (extension === '.jpg' || extension === '.jpeg') {
      return allowed.includes('.jpg') || allowed.includes('.jpeg');
    }
    return false;
  }

  private formatAllowedExtensionsForHint(extensions: string[]): string {
    const normalized = [
      ...new Set(
        extensions
          .map((e) => {
            const t = e.trim().toLowerCase();
            if (!t) {
              return '';
            }
            return t.startsWith('.') ? t : `.${t}`;
          })
          .filter(Boolean),
      ),
    ];
    const max = 12;
    if (normalized.length <= max) {
      return normalized.join(', ');
    }
    return `${normalized.slice(0, max).join(', ')}…`;
  }

  private formatMimeTypesForHint(types: string[]): string {
    const max = 6;
    if (types.length <= max) {
      return types.join(', ');
    }
    return `${types.slice(0, max).join(', ')}…`;
  }

  private downloadBlob(fileName: string, blob: Blob): void {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  private buildTreeRowsFor(expandedPaths: Set<string>, includeRootRow: boolean): TreeRow[] {
    const rows: TreeRow[] = [];
    const treeItems = this.store.treeItems();
    const childrenByParent = new Map<string, WhitecapFileItem[]>();

    for (const item of treeItems) {
      const parentPath = item.parentPath ?? '/';
      const siblings = childrenByParent.get(parentPath) ?? [];
      siblings.push(item);
      childrenByParent.set(parentPath, siblings);
    }

    for (const siblings of childrenByParent.values()) {
      siblings.sort((a, b) => a.name.localeCompare(b.name));
    }

    const traverse = (parentPath: string, depth: number): void => {
      const children = childrenByParent.get(parentPath) ?? [];
      for (const item of children) {
        const nestedFolderCount = (childrenByParent.get(item.path) ?? []).length;
        const expanded = expandedPaths.has(item.path);
        const displayChildCount = item.childCount ?? nestedFolderCount;
        rows.push({
          item,
          depth,
          hasChildren: nestedFolderCount > 0 || !!item.hasChildren,
          childCount: displayChildCount,
          expanded,
        });
        if (expanded) {
          traverse(item.path, depth + 1);
        }
      }
    };

    const rootChildren = childrenByParent.get('/') ?? [];
    if (includeRootRow) {
      const rootExpanded = expandedPaths.has('/');
      const rootFolderCount = rootChildren.length;
      const rootEntryTotal = this.store.treeRootEntryCount();
      const rootDisplayCount = rootEntryTotal != null ? rootEntryTotal : rootFolderCount;
      rows.push({
        item: {
          id: '__wcfm-root__',
          name: 'Root',
          path: '/',
          type: 'folder',
        },
        depth: 0,
        hasChildren: rootFolderCount > 0 || rootChildren.some((c) => !!c.hasChildren),
        childCount: rootDisplayCount,
        expanded: rootExpanded,
      });
      if (rootExpanded) {
        traverse('/', 1);
      }
    } else {
      traverse('/', 0);
    }
    return rows;
  }
}
