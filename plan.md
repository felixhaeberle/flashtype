# Flashtype Widget Architecture Refactor Plan

## Goal
Refactor Flashtype from a static `view` architecture to a `widget` architecture where:
- Flashtype is the shell.
- Flashtype opens a Lix instance.
- Widgets are installable from Lix filesystem paths under `.lix/app_data/flashtype/widgets/**/*`.
- Widget installation is global-version scoped so installed widgets are identical across all Lix versions.
- Widgets render in shell-managed panels and can be instantiated multiple times.

## Final vocabulary
- `Widget`: installable UI unit.
- `WidgetInstance`: one mounted instance in a panel/tab.
- `WidgetRuntime`: lifecycle + render host for widget instances.
- `WidgetRegistry`: aggregate of built-in widgets and Lix filesystem widgets.
- `Shell`: panel/layout/focus/drag/drop host owned by Flashtype.

## Non-goals
- Backwards compatibility aliasing (`view` -> `widget`) is explicitly not required.
- Widget API versioning is not included for this iteration.
- Per-widget multi-instance config is not included (all widgets are multi-instance by default).

## Filesystem contract
Canonical non-user root:
```txt
.lix/
  app_data/
    flashtype/
      widgets/
    other-app/
      ...
```

Widget install root:
- `.lix/app_data/flashtype/widgets/`

Scope rule:
- Data under `.lix/app_data/**` is global-version scoped and must be read/written with `lixcol_version_id = 'global'` when using versioned filesystem views.

## Source structure contract
Target source layout:
```txt
src/
  shell/
  widget-runtime/
  widgets/
  data/
  hooks/
  components/
  utils/
  test-utils/
  main.tsx
```

Responsibilities:
- `shell/`: host layout and panel orchestration (focus, drag/drop, tab UX, persisted shell UI state).
- `widget-runtime/`: widget abstractions and runtime wiring (types, registry, host lifecycle, dynamic loader).
- `widgets/`: built-in widget implementations only.
- `data/`: Lix-facing services and query modules.
- `utils/`: pure shared helpers (domain-neutral).

## Package format
Filesystem location:
- `.lix/app_data/flashtype/widgets/<widget-id>/manifest.json`
- `.lix/app_data/flashtype/widgets/<widget-id>/<entry>.js` (ESM only)

Manifest shape (MVP):
```json
{
  "id": "conversation",
  "name": "Conversation",
  "description": "Chat with project context",
  "icon": "message-square",
  "entry": "./index.js"
}
```

Rules:
- `id` must be unique across built-ins + installed widgets.
- `entry` must resolve to an ESM module inside widget directory.
- Invalid widgets are skipped with structured error logging.
- Widget files are read from the global version, never from version-local filesystem state.

## Runtime contract (MVP)
Widget module exports:
```ts
export type WidgetModule = {
  activate?: (args: { context: WidgetContext; instance: WidgetInstance }) =>
    void | (() => void);
  render: (args: {
    context: WidgetContext;
    instance: WidgetInstance;
    target: HTMLElement;
  }) => void | (() => void);
};
```

Execution model:
- Trusted, same-process execution.
- ESM dynamic import for widget entry modules.
- One host container per widget instance.

## Refactor phases

### Phase 1: Hard rename `view` -> `widget`
Codebase-wide rename of architecture primitives.

Primary targets:
- Types and interfaces
  - `ViewKind` -> `WidgetKind`
  - `ViewState` -> `WidgetState`
  - `ViewInstance` -> `WidgetInstance`
  - `ViewDefinition` -> `WidgetDefinition`
  - `ViewContext` -> `WidgetContext`
- Core files
  - `src/app/view-registry.tsx` -> `src/widget-runtime/widget-registry.tsx`
  - `src/app/view-host-registry.tsx` -> `src/widget-runtime/widget-host-registry.tsx`
  - `src/app/view-context.ts` -> `src/widget-runtime/widget-context.ts`
  - `src/app/react-view.tsx` -> `src/widget-runtime/react-widget.tsx`
  - `src/app/view-instance-helpers.ts` -> `src/widget-runtime/widget-instance-helpers.ts`
  - `src/app/*layout/panel shell code*` -> `src/shell/**`
  - `src/views/*` -> `src/widgets/*`
- Panel/layout API names
  - `openView` / `closeView` / `moveViewToPanel` -> widget equivalents
  - `onSelectView` / `onRemoveView` -> widget equivalents

Acceptance criteria:
- No `view` architecture identifiers remain in active source code (except lexical text in comments/docs where intentionally unchanged).
- Existing built-ins still render and behave identically after rename.

### Phase 2: Split registry into built-in + installed widgets
Create composition model:
- `BUILTIN_WIDGET_DEFINITIONS` (current hardcoded ones: files, search, tasks, etc.)
- `INSTALLED_WIDGET_DEFINITIONS` (loaded from Lix filesystem)
- merged map by `widget.kind` or `widget.id` (single canonical key selected during implementation)

Conflict policy:
- If id collision occurs, built-in wins; installed widget is ignored with warning.

Acceptance criteria:
- Shell can render all built-ins through new widget registry API.
- Registry supports runtime refresh of installed widgets.

### Phase 3: Lix filesystem discovery loader
Implement `loadWidgetsFromLix(lix)`:
- Query/scan `.lix/app_data/flashtype/widgets/**/manifest.json` from the global version filesystem.
- Parse manifest JSON.
- Resolve entry path relative to widget directory.
- Read ESM bundle source from Lix filesystem.
- Materialize module URL for import (Blob URL or equivalent safe browser path).
- Import module and validate runtime contract.
- Build `WidgetDefinition` and register.

Error handling:
- A single broken widget must not break shell boot.
- Collect and expose load errors in console and optional debug panel output.

Acceptance criteria:
- Creating a widget directory with valid manifest + ESM bundle makes widget appear without app restart after refresh/hot-reload trigger.

### Phase 4: Hot reload via observe on widget directory
Implement live updates using Lix observe:
- Observe changes under `.lix/app_data/flashtype/widgets/%`.
- Debounce reload to avoid reload storms during multi-file writes.
- Rebuild installed registry subset and swap atomically.

Lifecycle requirements:
- Existing mounted instances of removed widgets show controlled fallback state (e.g. “Widget no longer available”).
- Updated widgets remount cleanly with existing persisted instance state.

Acceptance criteria:
- Adding/modifying/removing widget files in Lix updates available widget list automatically.

### Phase 5: Install/uninstall semantics as filesystem operations
Define shell APIs:
- `installWidgetFromFiles(...)` -> writes directory/files into `.lix/app_data/flashtype/widgets/<id>/...` in the global version
- `uninstallWidget(id)` -> removes widget directory from the global version

Versioning model:
- No separate package manager layer.
- Lix commit history is the version/audit source of truth.
- Global widget set must be invariant when switching versions (version switches do not alter installed widgets).

Acceptance criteria:
- Install/uninstall reflected as regular Lix filesystem diffs and commits.

## Data and state migration
Persisted UI state currently stores view fields. Migrate on read:
- Rename persisted shape from view keys to widget keys.
- Keep migration adapter for one release cycle so existing local state hydrates.
- Strip transient launch args from persisted snapshots (already consistent with current behavior).

## Testing plan

### Unit
- Manifest parsing/validation.
- Entry path resolution security (no path traversal outside widget dir).
- Loader behavior for invalid manifest/module exports.
- Registry collision behavior.
- Observe debounce/reload behavior.

### Integration
- Boot shell with built-ins only.
- Install widget via filesystem write, verify appears in picker and renders.
- Edit widget bundle, verify hot reload behavior.
- Remove widget directory, verify mounted fallback and picker removal.
- Switch versions before/after install/uninstall and verify widget set remains identical.

### Regression
- Existing built-in widgets (files, search, tasks, markdown, commit, diff, terminal, etc.) still render and preserve prior behavior.
- Panel interactions (drag/drop/focus/close/reorder/pending) unchanged.

## Implementation checklist
1. Rename core types and host APIs from `view` to `widget`.
2. Establish target source layout (`shell/`, `widget-runtime/`, `widgets/`, `data/`, `utils/`) and relocate files from `src/app`.
3. Move built-in widgets from `src/views/*` to `src/widgets/*` and update exports/imports.
4. Introduce `builtin-widget-registry.ts` and `installed-widget-registry.ts`.
5. Implement widget manifest loader from Lix filesystem.
6. Implement ESM module loading pipeline for filesystem bundles.
7. Add observe-based hot reload for `.lix/app_data/flashtype/widgets/**/*`.
8. Add install/uninstall helper APIs (filesystem operations).
9. Add persisted-state migration adapter.
10. Add tests and update existing tests for renamed APIs.
11. Remove remaining `view` naming and dead code.

## Risks and mitigations
- Dynamic import/caching issues:
  - Mitigate by content-hash query suffix or Blob URL revocation strategy.
- Reload flapping during agent writes:
  - Mitigate with debounce + coalesced reload queue.
- Broken third-party widget crashes host:
  - Mitigate with per-widget try/catch boundaries and runtime validation.
- Persisted-state mismatch after rename:
  - Mitigate with explicit migration function and hydration tests.

## Open implementation choices (to decide during coding)
- Whether widget keying is `id` only or `kind` with namespaced id convention.
- UX for unavailable mounted widget (placeholder component vs auto-close tab).
