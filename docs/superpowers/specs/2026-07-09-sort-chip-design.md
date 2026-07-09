# Sort chip for the browse/search list

Date: 2026-07-09
Status: approved

## Problem

Sonar's modal always orders the cards it shows — the empty-query "browse"
view and the flat results of a typed search — by modification time (mtime).
There's no way to see notes ordered by when they were created or last
opened.

## Decisions

- New **"Sort" chip** in the existing chip row (`sonar-chips`), same pattern
  as the Date/Type chips: a button that opens a `Menu` with checkable
  options.
- Four values: **Relevance** (default) / **Created** / **Modified** /
  **Viewed**.
- Persisted in plugin settings (`data.json`), unlike the other chips (Title
  only/In/Tag/Date/Type), which reset every full Obsidian restart via the
  module-scoped `lastFilters`.
- **Viewed** with no frecency history for a path falls back to mtime.
- The sort applies to **both** the browse view and typed-search results —
  choosing a non-Relevance value overrides relevance ranking in search too.
- Sorted search results stay a **flat list** — no Today/Yesterday/… group
  headers are introduced there (those stay exclusive to the browse view).

## Architecture

### `src/settings.ts`

Add `browseSort: 'relevance' | 'created' | 'modified' | 'viewed'` to
`SonarSettings`, default `'relevance'`. Validate in `parseSettings` against
the whitelist of four keys, same style as `bodyFuzzy`; anything else falls
back to the default.

### `src/service/frecency.ts`

Add a public method to `FrecencyTracker`:

```ts
lastOpened(path: string): number | undefined {
  return this.entries.get(path)?.lastOpened;
}
```

`boost()` already exists but returns a computed multiplier, not the raw
timestamp needed for sorting/grouping.

### `src/service/search-service.ts`

`recent()` gains a `sortBy: 'created' | 'modified' | 'viewed'` parameter
(default `'modified'`, so the existing call sites keep today's behavior).

- `'modified'` → `entry.mtime` (unchanged).
- `'created'` → live-looked-up `TFile.stat.ctime` via
  `this.app.vault.getAbstractFileByPath(entry.path)`, falling back to
  `entry.mtime` if the file can't be resolved. `ctime` is **not** added to
  the persisted index (`DocEntry`/`index.bin`) — no serialization format
  change, no forced reindex for existing users.
- `'viewed'` → `this.frecency?.lastOpened(entry.path) ?? entry.mtime`.

The per-entry sort key must be computed for **all** live entries before
slicing to `limit` — sorting by mtime first and only then re-sorting the
top-N by a different field would silently exclude entries that belong in
the new ordering. Each returned result carries a `sortTime: number` field
carrying whichever value was used, so callers group/sort consistently
without re-deriving the metric.

### `src/service/file-catalog.ts`

Same treatment for the catalog-only browse path (canvas/base/audio/video,
which aren't in the content index). `FileCatalog` gains an optional
`frecency: FrecencyTracker | null` field, wired in `main.ts` the same way
`SearchService.frecency` already is. `recent()` gains the same `sortBy`
parameter and returns records carrying `sortTime`.

### `src/ui/modal.ts`

- `SortKey` type + `SORT_OPTIONS` list (label + key) for the menu.
- New private field `sortKey: SortKey`, initialized from
  `deps.settings.browseSort` in the constructor (not from `lastFilters` —
  this is the one piece of modal state that persists across restarts).
- `renderChips()`: render the 5th chip, icon `arrow-up-down`, label
  `Sort: <value>`, `is-active` when `sortKey !== 'relevance'`.
- `pickSort(e)`: opens a `Menu` with the four checkable options.
- `setSort(key)`: updates `sortKey`, writes `deps.settings.browseSort = key`,
  calls `deps.saveSettings()` (new callback on `ModalDeps`, wired in
  `main.ts`'s `openModal()` to `() => this.saveSettings()`), re-renders
  chips, and calls `refresh()`.
- `buildBrowse()`: resolves `sortKey === 'relevance' ? 'modified' : sortKey`
  and passes it to `service.recent()` / `fileCatalog.recent()` (via
  `buildCatalogBrowse()`); groups with `groupByRecency(recent, (r) =>
  r.sortTime, now)` instead of the current hardcoded `r.mtime`.
- `refresh()` (typed query): after building the fused `items` list and
  applying the type filter, if `sortKey !== 'relevance'` re-sort `items`
  descending by a new `sortTimeFor(path)` helper that reads
  `TFile.stat` from the vault directly and `deps.service.frecency
  .lastOpened()` for the viewed case (typed-search rows don't flow through
  `SearchService.recent()`, so this is a separate small lookup). This
  happens before the synthetic "Create note" / "Search with Exo" rows are
  appended — those have no real path and stay at the end untouched.

### `ModalDeps`

New field: `saveSettings: () => Promise<void>`.

## Out of scope

- No settings-tab entry for a "default sort" — the chip is the only
  surface, and it already persists.
- No change to the persisted index format or a forced reindex.
- No grouping headers in sorted search results.

## Testing

- `settings.test.ts`: `parseSettings` accepts each of the four valid
  `browseSort` values, and falls back to `'relevance'` for a missing or
  corrupt value.
- If the sort-time resolution logic can be cleanly factored into a pure
  function (mirroring `frecencyBoost`), add direct unit tests for it;
  otherwise it's covered indirectly, consistent with the rest of the
  modal UI (which has no dedicated test file today).
