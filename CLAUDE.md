# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**First-time setup (monorepo — must build library before serving demo):**
```bash
npm i && ng build whitecap-file-manager && ng serve demo
```

**Build:**
```bash
ng build whitecap-file-manager   # build the library to dist/
ng build                          # build everything
```

**Develop:**
```bash
ng serve demo                     # serve demo app at http://localhost:4200
npm run watch                     # incremental build in watch mode
```

**Test:**
```bash
npm test                          # run all tests (Karma + Jasmine)
```

**Regenerate brand icons:**
```bash
npm run icons:regen
```

## Architecture

This is an Angular monorepo containing two projects:

1. **`whitecap-file-manager`** (library) — a production-grade standalone Angular file manager component, built to replicate Syncfusion's File Manager without that dependency.
2. **`demo`** (application) — host app for development and manual testing, with mock storage providers.

The library is imported via a path alias (`whitecap-file-manager` → `./dist/whitecap-file-manager`), so the library must be built before the demo app can compile.

### Library structure (`projects/whitecap-file-manager/src/lib/`)

| File | Role |
|------|------|
| `whitecap-file-manager.ts` | Main `WhitecapFileManagerComponent` — entire template is embedded here |
| `file-manager.store.ts` | Signal-based state (provided at component level, not app level) |
| `models.ts` | All public interfaces and types |
| `default-toolbar-actions.ts` | Default toolbar button configuration |
| `file-type-icons.ts` | Maps file extensions to icon names |
| `brand-file-type-svgs.ts` | Inline SVG strings for file/brand icons |
| `provider.token.ts` | `WHITECAP_STORAGE_PROVIDER` injection token |

### Key design patterns

**Provider pattern** — All backend/storage access flows through a `WhitecapStorageProvider` interface injected via `WHITECAP_STORAGE_PROVIDER`. The component is backend-agnostic. The demo uses in-memory mock providers; there is no real backend required for development.

**Signal-first state** — `FileManagerStore` manages all component state as Angular signals. It is provided at the component level (`providers: [FileManagerStore]`), so each component instance gets its own store.

**Observable-based provider contract** — All `WhitecapStorageProvider` methods return `Observable<T>`. After any mutation, the store calls `refresh()` to reload the current view.

**Path convention** — All file paths are POSIX-style with a leading slash (e.g., `/docs/report.pdf`).

### Public API

The component exports from `public-api.ts`:
- `WhitecapFileManagerComponent` — standalone component (selector: `whitecap-file-manager`)
- All types from `models.ts`: `WhitecapFileItem`, `WhitecapStorageProvider`, `WhitecapFileQuery`, `WhitecapUploadProgress`, etc.
- `DEFAULT_TOOLBAR_ACTIONS` — default toolbar config
- `WHITECAP_STORAGE_PROVIDER` — injection token

**Inputs:** `provider`, `initialPath`, `actions`, `enableFolderUpload`, `uploadValidation`, `defaultDuplicateStrategy`, `previewPaneVisible`, `height`

**Outputs:** `folderChanged`, `fileOpened`, `selectionChanged`, `uploadStarted`, `uploadCompleted`, `uploadFailed`, `fileDeleted`, `fileRenamed`, `fileMoved`, `fileCopied`

### Styling

Tailwind CSS v4 is used for all styles. Styles are applied inline in the component template. The demo entry stylesheet is at `projects/demo/src/styles.css`.

## Key documents

- [`docs/production-integration.md`](docs/production-integration.md) — full integration guide: provider implementation contract, feature catalog, pre-go-live checklist
- [`target.md`](target.md) — original product specification and feature requirements
