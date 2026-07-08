# Sonar — Universal File Finder, HTML content, dual-fuzzy

**Date:** 2026-07-08
**Status:** approved (design)
**Repo:** `obsidian-sonar`

## What & why

Sonar today indexes only `.md` (BM25F), with PDF/image content indexed *only*
when the Text Extractor plugin is installed. There is no way to find a
non-markdown file by name (a PDF, an image, a `.canvas`, a generated HTML
artifact), no subsequence "fuzzy filename" matching (fzf/Quick-Switcher style),
and HTML file content is invisible.

This project adds three capabilities on top of the existing engine:

1. **Universal file finder** — find *any* file in the vault by name, regardless
   of type or whether its content is indexed. Non-content files appear as
   first-class results with a per-type icon.
2. **Dual fuzzy** — subsequence fuzzy on filenames (new) + configurable
   aggressiveness for the existing body Levenshtein fuzzy.
3. **Native HTML content extraction** — HTML files are parsed natively (no
   plugin) and their text enters the same index as markdown. Driver: the
   `Resources/_artifacts/` folder full of self-contained HTML.

PDF/image content extraction stays delegated to Text Extractor, unchanged. No
new heavy dependencies; `isDesktopOnly` stays `false`.

**Tangible example.**
- Before: typing `srvc` finds nothing; the file `search-service.ts` is
  invisible (not markdown). A generated `GTM Gravity.html` artifact can't be
  found by its text. A `Roadmap.canvas` can't be found at all.
- After: `srvc` surfaces `search-service.ts` via subsequence match; `GTM
  Gravity.html` is found both by name and by its rendered text; `Roadmap.canvas`
  appears by name with a canvas icon.

## Approach (chosen: A — provider-based)

Sonar already has a `ProviderRegistry` that runs independent `SearchProvider`s
and merges their ranked lists with Reciprocal Rank Fusion (`fuse.ts`). The
registry was explicitly built to accept more providers ("Wave 2's provider will
register alongside it"). The universal file finder registers as a **new fused
provider**; no ranking/merge logic changes. HTML enters the existing index as a
new `DocType`. Fuzzy splits into two independent mechanisms.

Rejected: (B) putting every file as an empty-body document in the
`InvertedIndex` — pollutes BM25F document-length stats, bloats the binary cache,
touches DocType/extraction everywhere. (C) inlining filename fuzzy inside
`SearchService.query` — bypasses the provider abstraction that exists for
exactly this.

## Architecture

### Data flow

```
        ┌──────────────── ProviderRegistry.query(raw) ────────────────┐
        │                                                             │
   [KeywordProvider]  (list passed FIRST)              [FileFinderProvider]
   BM25F over md/pdf/img/html                           subseq over ALL files
   InvertedIndex                                        FileCatalog
        │  ProviderResult[]                                   │  ProviderResult[]
        └──────────────────► reciprocalRankFusion ◄───────────┘
                                    │  (dedup by path — existing)
                               fused: ProviderResult[]
                                    │
                            modal → result-renderer (icon by ext ?? docType)
```

### Units (each: purpose / interface / deps)

**`src/index/subseq.ts`** *(new, pure — zero Obsidian imports)*
- **Does:** score a candidate string against a query by subsequence match
  (query chars in order), rewarding consecutive runs, word-boundary starts, and
  CamelCase/separator boundaries (`-`, `_`, `/`, space). Returns `null` when the
  query is not a subsequence, else a numeric score (higher = better).
- **Interface:** `subsequenceScore(query: string, candidate: string): number | null`
- **Deps:** none. Unit-tested headless like the rest of `src/index/`.
- **Notes:** diacritics-folded to match the engine's existing folding behavior
  (reuse the tokenizer's fold helper).

**`src/service/file-catalog.ts`** *(new)*
- **Does:** hold a lightweight record of *every* file in the vault
  `{ path, basename, ext, mtime }`, built from `vault.getFiles()` and maintained
  incrementally on `create` / `rename` / `delete`. Provides
  `search(query, limit)` using `subsequenceScore` over `basename` (with a small
  bonus if the path also matches), sorted by score then recency.
- **Interface:** `build()`, `onCreate/onRename/onDelete(file)`,
  `search(query, limit): FileHit[]` where `FileHit = { path, basename, ext, mtime, score }`.
- **Deps:** Obsidian `Vault` (read-only), `subseq.ts`.
- **Notes:** NOT serialized — rebuilt from `getFiles()` at boot in a few ms. No
  `SCHEMA_VERSION` impact.

**`src/service/file-finder-provider.ts`** *(new)*
- **Does:** adapt `FileCatalog` to the `SearchProvider` interface.
  `mode: 'instant'`, `fused: true`, `id: 'files'`, `label: 'Files'`.
- **Interface:** implements `SearchProvider.search()` → `ProviderResult[]`, each
  carrying `ext` for icon selection.
- **Deps:** `FileCatalog`.
- **Notes:** applies a minimum-score threshold and a result cap so 1–2 char
  queries don't flood the fused list and drown content matches.

**`src/index/html-extract.ts`** *(new, pure)*
- **Does:** turn raw HTML into plain text — remove `<script>` and `<style>`
  blocks, strip tags, decode common entities, collapse whitespace; return
  `{ title, text }` where `title` comes from `<title>` when present.
- **Interface:** `htmlToText(raw: string): { title: string | null; text: string }`
- **Deps:** none. Unit-tested.

### Changes to existing files

**`src/index/fields.ts`**
- `DocType` becomes `'md' | 'pdf' | 'image' | 'html'`.

**`src/types.ts`**
- `ProviderResult` gains optional `ext?: string` (raw file extension for icon
  selection on non-content files). `docType` stays the narrow indexed-content
  type.

**`src/service/search-service.ts`**
- Initial build: enumerate `.html` files alongside markdown; for each, read →
  `htmlToText` → `extractFields({ basename, content: text })` →
  `addDocument({ docType: 'html', ... })`. Reuse the existing timeout/
  concurrency guards.
- Incremental: register `vault.on('create' | 'modify' | 'delete')` handlers for
  `.html` (the existing `metadataCache.on('changed')` only fires for markdown).
  Route html changes through the same debounce/tombstone path as md.
- Body fuzzy gate becomes configurable (see settings).

**`src/index/search-core.ts`**
- The hardcoded `FUZZY_MIN = 5` gate becomes driven by a setting:
  `off` (never), `on-sparse` (current behavior, default), `always` (drop the
  gate; the existing `fuzzyWeight` penalty contains noise).

**`src/ui/result-renderer.ts`**
- `ICONS` keyed by **extension** with fallback, e.g. `pdf`→`file-type`,
  `png/jpg/…`→`image`, `html`→`globe`/`code`, `canvas`→`layout-dashboard`,
  `base`→`database`, `zip`→`file-archive`, `mp4/mov`→`film`, `mp3/wav`→`music`,
  default→`file`. Selection: `ICONS[result.ext] ?? ICONS_BY_DOCTYPE[result.docType] ?? 'file-text'`.

**`src/index/serialize.ts`**
- Bump `SCHEMA_VERSION` (a new `html` docType enters the serialized index).

**`src/main.ts`**
- Construct `FileCatalog`, register `FileFinderProvider` with the registry
  (after `KeywordProvider`, so keyword results are the first list into RRF and
  win the dedup for the richer excerpt-carrying item).

### Settings (new)

- **Index HTML content** (toggle, default on) — enumerate/extract `.html`.
- **Body fuzzy** (dropdown: off / on-sparse / always, default on-sparse).
- File finder is always on (no toggle in v1).

## Ranking & merge behavior

- `reciprocalRankFusion` already keys items by `path`, so a file that matches
  both by content (keyword) and by name (finder) is deduped — no new merge code.
- The keyword list is passed to the registry/RRF **first**, so when the same
  path appears in both lists the retained item is the keyword result (which
  carries the excerpt); both lists still contribute to the fused score.
- File-finder minimum-score threshold + cap prevent short queries from
  flooding results.

## Error handling

- HTML read/parse failures: caught per-file, logged, file skipped (mirror the
  Extractor's `skip` set pattern). One bad file never stalls the build.
- File catalog rename/delete events that reference unknown paths are ignored.
- Subsequence scorer is total (returns `null` for non-match) — no throwing.

## Testing

- `subseq.test.ts` — ordering (`srvc`→`search-service` beats unrelated),
  non-subsequence returns `null`, boundary/CamelCase bonuses, diacritics fold.
- `html-extract.test.ts` — script/style stripped, tags removed, entities
  decoded, `<title>` captured, self-contained artifact sample.
- `file-catalog.test.ts` — build from a file list, incremental add/rename/
  delete, search ordering + limit + threshold.
- `search-core.test.ts` — extend for the three body-fuzzy modes.
- Existing `release-contract` / serialize tests updated for the
  `SCHEMA_VERSION` bump.

## Out of scope (YAGNI)

- Native PDF (pdf.js) and OCR (tesseract) — stay on Text Extractor.
- A file-type filter UI — icons only in v1.
- Persisting the file catalog to the binary cache.

## Attention points

1. **RRF dedup** — confirmed already keyed by `path`; ensure keyword list is
   registered/passed first.
2. **Short-query noise** — threshold + cap in the file-finder provider.
3. **`isDesktopOnly` stays false** — HTML extraction is pure string work.
4. **HTML incremental events** — must use `vault.on('modify')`, not
   `metadataCache.on('changed')` (markdown-only).
