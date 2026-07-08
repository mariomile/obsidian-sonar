# Sonar — Universal File Finder + HTML + Dual-Fuzzy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Sonar find any vault file by fuzzy name, index HTML content natively, and make body fuzzy configurable — without touching the ranking core.

**Architecture:** A new `FileFinderProvider` registers with the existing `ProviderRegistry` (RRF fusion already dedups by `path`). HTML enters the existing `InvertedIndex` as a new `DocType`. Filename fuzzy (subsequence) and body fuzzy (Levenshtein, now gated by a setting) are two independent mechanisms.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild, vitest. Pure logic lives in `src/index/` (zero Obsidian imports, headless-tested); Obsidian glue lives in `src/service/`, `src/ui/`, `src/main.ts`.

## Global Constraints

- `isDesktopOnly` stays `false` (`manifest.json`) — add no heavy runtime deps; HTML parsing is pure string work.
- Do NOT bump `manifest.json` / `package.json` / `versions.json` version — `release-contract.test.ts` asserts they stay in sync; leave all three untouched.
- Pure modules under `src/index/` MUST NOT import from `obsidian`.
- Diacritics folding for matching uses `fold()` from `src/index/tokenizer.ts` (`NFKD` + strip combining marks + lowercase) — reuse it, don't reimplement.
- Every task ends green: `pnpm test` (vitest) and `pnpm typecheck` pass.
- Commit after each task.

---

### Task 1: Subsequence filename scorer (`subseq.ts`)

**Files:**
- Create: `src/index/subseq.ts`
- Test: `src/index/subseq.test.ts`

**Interfaces:**
- Consumes: `fold` from `src/index/tokenizer.ts`.
- Produces: `subsequenceScore(query: string, candidate: string): number | null` — `null` when `query` is not a subsequence of `candidate` (after folding both); otherwise a positive number, higher = better. Bonuses: +consecutive-run, +word-boundary start (position 0 or preceded by one of `-_/. ` or a lower→upper CamelCase transition).

- [ ] **Step 1: Write the failing test**

```ts
// src/index/subseq.test.ts
import { describe, it, expect } from 'vitest';
import { subsequenceScore } from './subseq.ts';

describe('subsequenceScore', () => {
  it('returns null when not a subsequence', () => {
    expect(subsequenceScore('xyz', 'search-service')).toBeNull();
  });

  it('matches a scattered subsequence', () => {
    expect(subsequenceScore('srvc', 'search-service')).not.toBeNull();
  });

  it('ranks boundary/consecutive matches above scattered ones', () => {
    const boundary = subsequenceScore('ss', 'search-service')!; // two word-starts
    const scattered = subsequenceScore('ss', 'passes')!;         // mid-word
    expect(boundary).toBeGreaterThan(scattered);
  });

  it('rewards a consecutive run over gaps', () => {
    const run = subsequenceScore('sear', 'search-service')!;
    const gappy = subsequenceScore('sear', 's-e-a-r-x')!;
    expect(run).toBeGreaterThan(gappy);
  });

  it('folds diacritics and case', () => {
    expect(subsequenceScore('perche', 'Perché note')).not.toBeNull();
    expect(subsequenceScore('MRIO', 'Mario Miletta')).not.toBeNull();
  });

  it('treats CamelCase transitions as boundaries', () => {
    const camel = subsequenceScore('ss', 'searchService')!;
    const mid = subsequenceScore('ss', 'passe')!;
    expect(camel).toBeGreaterThan(mid);
  });

  it('empty query returns null', () => {
    expect(subsequenceScore('', 'anything')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Dev\ Projects/obsidian-sonar && pnpm vitest run src/index/subseq.test.ts`
Expected: FAIL — `Cannot find module './subseq.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/index/subseq.ts
import { fold } from './tokenizer.ts';

const BOUNDARY_BEFORE = new Set(['-', '_', '/', '.', ' ']);

/** Is position `i` in the ORIGINAL (unfolded) candidate a word boundary? */
function isBoundary(original: string, i: number): boolean {
  if (i === 0) return true;
  const prev = original[i - 1]!;
  if (BOUNDARY_BEFORE.has(prev)) return true;
  // CamelCase: lower/digit → upper transition.
  const cur = original[i]!;
  return prev.toLowerCase() === prev && cur.toLowerCase() !== cur;
}

/**
 * fzf-style subsequence score. Greedy left-to-right match of every folded
 * query char against the folded candidate; returns null if the query is not a
 * subsequence. Score rewards consecutive runs and word-boundary starts, and
 * lightly penalizes leading gap so earlier/tighter matches rank higher.
 */
export function subsequenceScore(query: string, candidate: string): number | null {
  const q = fold(query);
  if (q.length === 0) return null;
  const c = fold(candidate);
  if (c.length === 0) return null;

  let ci = 0;
  let score = 0;
  let prevMatch = -2; // so the first match is never "consecutive"
  let firstMatch = -1;

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    let found = -1;
    for (let k = ci; k < c.length; k++) {
      if (c[k] === ch) { found = k; break; }
    }
    if (found === -1) return null;
    if (firstMatch === -1) firstMatch = found;

    let charScore = 1;
    if (found === prevMatch + 1) charScore += 3;              // consecutive run
    if (isBoundary(candidate, found)) charScore += 4;         // word/camel boundary
    score += charScore;

    prevMatch = found;
    ci = found + 1;
  }

  // Prefer matches that start earlier and are less spread out.
  score -= firstMatch * 0.1;
  score -= (prevMatch - firstMatch - (q.length - 1)) * 0.2; // total gap length
  return score;
}
```

> Note: `isBoundary` indexes the ORIGINAL `candidate` while matching happens on the FOLDED `c`. `fold()` is NFKD + strip-combining + lowercase; it can change string length for exotic input. For filenames this is safe in practice, but to keep indices aligned the implementation matches on `c` and reads boundaries from `candidate` at the SAME index — acceptable because folding filenames (ASCII + accented Latin) preserves length 1:1. Do not extend this to arbitrary Unicode without revisiting.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/index/subseq.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/index/subseq.ts src/index/subseq.test.ts
git commit -m "feat(index): subsequence filename scorer for fuzzy file finder"
```

---

### Task 2: Native HTML → text extractor (`html-extract.ts`)

**Files:**
- Create: `src/index/html-extract.ts`
- Test: `src/index/html-extract.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `htmlToText(raw: string): { title: string | null; text: string }` — strips `<script>`/`<style>` blocks and all tags, decodes common entities, collapses whitespace; `title` from the first `<title>` tag or `null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/index/html-extract.test.ts
import { describe, it, expect } from 'vitest';
import { htmlToText } from './html-extract.ts';

describe('htmlToText', () => {
  it('extracts visible text and drops tags', () => {
    const { text } = htmlToText('<p>Hello <b>world</b></p>');
    expect(text).toBe('Hello world');
  });

  it('removes script and style contents', () => {
    const { text } = htmlToText(
      '<style>.x{color:red}</style><script>alert(1)</script><p>keep</p>',
    );
    expect(text).toBe('keep');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color');
  });

  it('captures the title', () => {
    const { title } = htmlToText('<html><head><title>GTM Gravity</title></head><body>x</body></html>');
    expect(title).toBe('GTM Gravity');
  });

  it('returns null title when absent', () => {
    expect(htmlToText('<p>x</p>').title).toBeNull();
  });

  it('decodes common entities and collapses whitespace', () => {
    const { text } = htmlToText('<p>a &amp; b\n\n   c&nbsp;d</p>');
    expect(text).toBe('a & b c d');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/index/html-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/index/html-extract.ts

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/**
 * Turn raw HTML into plain text for indexing. Removes script/style blocks and
 * all tags, decodes entities, collapses whitespace. Pure string processing —
 * no DOM, so it runs headless and adds no dependency.
 */
export function htmlToText(raw: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  const title = titleMatch ? decodeEntities(titleMatch[1]!).trim() || null : null;

  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(stripped).replace(/\s+/g, ' ').trim();
  return { title, text };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/index/html-extract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/index/html-extract.ts src/index/html-extract.test.ts
git commit -m "feat(index): native HTML→text extraction"
```

---

### Task 3: `DocType` html, `ProviderResult.ext`, icon-by-extension

**Files:**
- Modify: `src/index/fields.ts` (DocType union)
- Modify: `src/types.ts` (`ProviderResult.ext?`)
- Create: `src/ui/icons.ts`
- Create: `src/ui/icons.test.ts`
- Modify: `src/ui/result-renderer.ts` (use `iconFor`)

**Interfaces:**
- Produces: `iconFor(ext: string | undefined, docType: DocType): string` — Obsidian icon name. Extension wins; falls back to docType; final fallback `'file'`.

- [ ] **Step 1: Widen DocType**

In `src/index/fields.ts`, change:

```ts
export type DocType = 'md' | 'pdf' | 'image' | 'html';
```

- [ ] **Step 2: Add `ext` to ProviderResult**

In `src/types.ts`, inside `interface ProviderResult`, add after `docType`:

```ts
  /** Raw file extension (lowercase), for icon selection on non-content files. */
  ext?: string;
```

- [ ] **Step 3: Write the failing icon test**

```ts
// src/ui/icons.test.ts
import { describe, it, expect } from 'vitest';
import { iconFor } from './icons.ts';

describe('iconFor', () => {
  it('maps known extensions', () => {
    expect(iconFor('pdf', 'pdf')).toBe('file-type');
    expect(iconFor('canvas', 'md')).toBe('layout-dashboard');
    expect(iconFor('png', 'image')).toBe('image');
    expect(iconFor('zip', 'md')).toBe('file-archive');
  });

  it('falls back to docType when ext unknown', () => {
    expect(iconFor('xyz', 'md')).toBe('file-text');
    expect(iconFor(undefined, 'image')).toBe('image');
  });

  it('final fallback is file', () => {
    expect(iconFor('xyz', 'md' as never)).toBe('file-text'); // docType md → file-text
    expect(iconFor('xyz', undefined as never)).toBe('file');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run src/ui/icons.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `icons.ts`**

```ts
// src/ui/icons.ts
import type { DocType } from '../index/fields.ts';

const BY_EXT: Record<string, string> = {
  pdf: 'file-type',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  bmp: 'image', tiff: 'image', svg: 'image',
  html: 'globe', htm: 'globe',
  canvas: 'layout-dashboard',
  base: 'database',
  zip: 'file-archive', gz: 'file-archive', tar: 'file-archive', rar: 'file-archive',
  mp4: 'film', mov: 'film', webm: 'film', mkv: 'film',
  mp3: 'music', wav: 'music', m4a: 'music', flac: 'music',
  json: 'braces', csv: 'table', xlsx: 'table',
};

const BY_DOCTYPE: Record<DocType, string> = {
  md: 'file-text',
  pdf: 'file-type',
  image: 'image',
  html: 'globe',
};

/** Pick an Obsidian icon: extension first, then docType, then a generic file. */
export function iconFor(ext: string | undefined, docType: DocType): string {
  if (ext && BY_EXT[ext]) return BY_EXT[ext]!;
  if (docType && BY_DOCTYPE[docType]) return BY_DOCTYPE[docType]!;
  return 'file';
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/ui/icons.test.ts`
Expected: PASS.

- [ ] **Step 7: Use `iconFor` in the renderer**

In `src/ui/result-renderer.ts`: delete the local `ICONS` map (lines ~16-19) and its usage. Import and use `iconFor`. Replace:

```ts
setIcon(icon, ICONS[result.docType] ?? 'file-text');
```

with:

```ts
setIcon(icon, iconFor(result.ext, result.docType));
```

Add at top: `import { iconFor } from './icons.ts';` and ensure the renderer's result type includes optional `ext?: string` (it renders `ProviderResult`; if it uses a local interface, add `ext?: string` to it).

- [ ] **Step 8: Typecheck, full test, commit**

```bash
pnpm typecheck && pnpm vitest run
git add src/index/fields.ts src/types.ts src/ui/icons.ts src/ui/icons.test.ts src/ui/result-renderer.ts
git commit -m "feat(ui): per-extension result icons; DocType html; ProviderResult.ext"
```

---

### Task 4: File catalog (`file-catalog.ts`)

**Files:**
- Create: `src/service/file-catalog.ts`
- Test: `src/service/file-catalog.test.ts`

**Interfaces:**
- Consumes: `subsequenceScore` (Task 1); Obsidian `Vault`, `TFile`.
- Produces:
  - `interface FileRecord { path: string; basename: string; ext: string; mtime: number }`
  - `interface FileHit extends FileRecord { score: number }`
  - `searchCatalog(records: readonly FileRecord[], query: string, opts: { limit: number; minScore?: number }): FileHit[]` (pure — exported for tests)
  - `class FileCatalog` with `build(): void`, `add(file: TFile): void`, `remove(path: string): void`, `rename(oldPath: string, file: TFile): void`, `search(query: string, limit: number): FileHit[]`.

- [ ] **Step 1: Write the failing pure-search test**

```ts
// src/service/file-catalog.test.ts
import { describe, it, expect } from 'vitest';
import { searchCatalog, type FileRecord } from './file-catalog.ts';

const recs: FileRecord[] = [
  { path: 'src/service/search-service.ts', basename: 'search-service', ext: 'ts', mtime: 3 },
  { path: 'Atlas/People/Mario Miletta.md', basename: 'Mario Miletta', ext: 'md', mtime: 2 },
  { path: 'Resources/_artifacts/GTM Gravity.html', basename: 'GTM Gravity', ext: 'html', mtime: 1 },
];

describe('searchCatalog', () => {
  it('finds a file by scattered subsequence of its name', () => {
    const hits = searchCatalog(recs, 'srvc', { limit: 10 });
    expect(hits[0]!.basename).toBe('search-service');
  });

  it('excludes non-subsequence candidates', () => {
    const hits = searchCatalog(recs, 'zzz', { limit: 10 });
    expect(hits).toHaveLength(0);
  });

  it('respects the limit', () => {
    const hits = searchCatalog(recs, 'a', { limit: 1 });
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it('drops hits below minScore', () => {
    const hits = searchCatalog(recs, 'a', { limit: 10, minScore: 1000 });
    expect(hits).toHaveLength(0);
  });

  it('ties break by recency (mtime desc)', () => {
    const two: FileRecord[] = [
      { path: 'a/note.md', basename: 'note', ext: 'md', mtime: 1 },
      { path: 'b/note.md', basename: 'note', ext: 'md', mtime: 9 },
    ];
    const hits = searchCatalog(two, 'note', { limit: 10 });
    expect(hits[0]!.path).toBe('b/note.md');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/service/file-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `file-catalog.ts`**

```ts
// src/service/file-catalog.ts
import { type App, TFile } from 'obsidian';
import { subsequenceScore } from '../index/subseq.ts';

export interface FileRecord {
  path: string;
  basename: string;
  ext: string;
  mtime: number;
}

export interface FileHit extends FileRecord {
  score: number;
}

/**
 * Pure ranked search over file records by subsequence match on the basename.
 * Exported separately from the class so ranking is unit-tested headless.
 */
export function searchCatalog(
  records: readonly FileRecord[],
  query: string,
  opts: { limit: number; minScore?: number },
): FileHit[] {
  const minScore = opts.minScore ?? 0;
  const hits: FileHit[] = [];
  for (const r of records) {
    const s = subsequenceScore(query, r.basename);
    if (s === null || s < minScore) continue;
    hits.push({ ...r, score: s });
  }
  hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return hits.slice(0, opts.limit);
}

/**
 * Lightweight index of EVERY file in the vault (all extensions), maintained
 * incrementally. Powers the universal file finder. Not serialized — rebuilt
 * from `vault.getFiles()` at boot in a few ms.
 */
export class FileCatalog {
  private records = new Map<string, FileRecord>();

  constructor(private readonly app: App) {}

  private toRecord(file: TFile): FileRecord {
    return {
      path: file.path,
      basename: file.basename,
      ext: file.extension.toLowerCase(),
      mtime: file.stat.mtime,
    };
  }

  build(): void {
    this.records.clear();
    for (const file of this.app.vault.getFiles()) {
      this.records.set(file.path, this.toRecord(file));
    }
  }

  add(file: TFile): void {
    this.records.set(file.path, this.toRecord(file));
  }

  remove(path: string): void {
    this.records.delete(path);
  }

  rename(oldPath: string, file: TFile): void {
    this.records.delete(oldPath);
    this.records.set(file.path, this.toRecord(file));
  }

  search(query: string, limit: number): FileHit[] {
    // minScore keeps 1–2 char queries from flooding results with weak matches.
    return searchCatalog([...this.records.values()], query, { limit, minScore: 2 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/service/file-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/service/file-catalog.ts src/service/file-catalog.test.ts
git commit -m "feat(service): FileCatalog + pure searchCatalog for universal file finder"
```

---

### Task 5: File finder provider (`file-finder-provider.ts`) — Attention point #2 (short-query noise)

**Files:**
- Create: `src/service/file-finder-provider.ts`
- Test: `src/service/file-finder-provider.test.ts`

**Interfaces:**
- Consumes: `FileCatalog`/`FileHit` (Task 4); `SearchProvider`, `ProviderResult`, `ProviderSearchOptions` (`src/types.ts`).
- Produces: `class FileFinderProvider implements SearchProvider` — `id='files'`, `label='Files'`, `mode='instant'`, `fused=true`. Maps `FileHit → ProviderResult` with `ext`, `docType` guessed for known content types (`md`/`pdf`/`image`/`html`) else `'md'` as a neutral default (icon still uses `ext`).

- [ ] **Step 1: Write the failing test**

```ts
// src/service/file-finder-provider.test.ts
import { describe, it, expect } from 'vitest';
import { FileFinderProvider } from './file-finder-provider.ts';
import type { FileCatalog, FileHit } from './file-catalog.ts';

function fakeCatalog(hits: FileHit[]): FileCatalog {
  return { search: () => hits } as unknown as FileCatalog;
}

const opts = { limit: 10, now: 0, signal: new AbortController().signal };

describe('FileFinderProvider', () => {
  it('maps catalog hits to provider results with ext', async () => {
    const p = new FileFinderProvider(
      fakeCatalog([{ path: 'a/x.canvas', basename: 'x', ext: 'canvas', mtime: 1, score: 9 }]),
    );
    const out = await p.search('x', opts);
    expect(out[0]).toMatchObject({ path: 'a/x.canvas', ext: 'canvas', source: 'files' });
  });

  it('is instant and fused', () => {
    const p = new FileFinderProvider(fakeCatalog([]));
    expect(p.mode).toBe('instant');
    expect(p.fused).toBe(true);
    expect(p.isAvailable()).toBe(true);
  });

  it('returns nothing for a blank query (no flooding)', async () => {
    const p = new FileFinderProvider(fakeCatalog([]));
    expect(await p.search('   ', opts)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/service/file-finder-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `file-finder-provider.ts`**

```ts
// src/service/file-finder-provider.ts
import type { DocType } from '../index/fields.ts';
import type { ProviderResult, ProviderSearchOptions, SearchProvider } from '../types.ts';
import type { FileCatalog } from './file-catalog.ts';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'svg']);

function docTypeFor(ext: string): DocType {
  if (ext === 'md') return 'md';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'md'; // neutral; icon selection uses `ext`, so this only affects fallback
}

/**
 * Universal file finder: subsequence match over every file in the vault by
 * name. Registers as an instant, fused provider so its hits RRF-merge with the
 * keyword engine. Blank queries return nothing so short input can't flood.
 */
export class FileFinderProvider implements SearchProvider {
  readonly id = 'files';
  readonly label = 'Files';
  readonly mode = 'instant' as const;
  readonly fused = true;

  constructor(private readonly catalog: FileCatalog) {}

  isAvailable(): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async search(raw: string, opts: ProviderSearchOptions): Promise<ProviderResult[]> {
    const q = raw.trim();
    if (q.length === 0) return [];
    return this.catalog.search(q, opts.limit).map((h) => ({
      path: h.path,
      basename: h.basename,
      docType: docTypeFor(h.ext),
      ext: h.ext,
      score: h.score,
      source: this.id,
      matched: [],
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/service/file-finder-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/service/file-finder-provider.ts src/service/file-finder-provider.test.ts
git commit -m "feat(service): FileFinderProvider — universal fuzzy file finder"
```

---

### Task 6: Native HTML content indexing — Attention point #4 (HTML incremental events)

**Files:**
- Modify: `src/settings.ts` (add `indexHtml`)
- Modify: `src/settings.test.ts` (cover the new field)
- Modify: `src/index/serialize.ts` (`SCHEMA_VERSION` bump)
- Modify: `src/service/search-service.ts` (enumerate + index + incremental events for `.html`)

**Interfaces:**
- Consumes: `htmlToText` (Task 2), `extractFields` (`src/index/field-extract.ts`), `SonarSettings.indexHtml`.
- Produces: `.html` files present in the `InvertedIndex` with `docType: 'html'`; incremental updates on create/modify/delete/rename.

- [ ] **Step 1: Add the `indexHtml` setting (test first)**

In `src/settings.test.ts`, add:

```ts
it('defaults indexHtml to true and coerces it to boolean', () => {
  expect(parseSettings({}).indexHtml).toBe(true);
  expect(parseSettings({ indexHtml: 0 }).indexHtml).toBe(false);
});
```

Run: `pnpm vitest run src/settings.test.ts` → FAIL (`indexHtml` undefined).

Then in `src/settings.ts`:
- Add to `interface SonarSettings`: `/** Index text content of HTML files natively (no plugin). */ indexHtml: boolean;`
- Add to `DEFAULT_SETTINGS`: `indexHtml: true,`
- Add to `parseSettings` return: `indexHtml: d.indexHtml ?? DEFAULT_SETTINGS.indexHtml,`

Run again → PASS.

- [ ] **Step 2: Bump the cache schema version**

In `src/index/serialize.ts`, change `export const SCHEMA_VERSION = 1;` to `= 2;` (a new `html` docType enters the serialized index; bumping forces a clean rebuild rather than mixing schemas).

Run: `pnpm vitest run src/index/serialize.test.ts` — if a test asserts the literal version, update it to `2`.

- [ ] **Step 3: Index HTML in the initial build**

In `src/service/search-service.ts`, add a helper next to `indexFile`:

```ts
/** Read, extract, and index a single HTML file's text as docType 'html'. */
private async indexHtmlFile(file: TFile): Promise<void> {
  let raw = '';
  try {
    raw = await withTimeout(this.app.vault.cachedRead(file), READ_TIMEOUT_MS);
  } catch {
    return;
  }
  const { title, text } = htmlToText(raw);
  const basename = title ?? file.basename;
  const { fields, tags } = extractFields({ basename, content: text, meta: {} });
  if (this.index.getIdByPath(file.path) !== undefined) this.index.tombstone(file.path);
  this.index.addDocument({
    path: file.path,
    basename: file.basename, // display name stays the filename
    mtime: file.stat.mtime,
    size: file.stat.size,
    docType: 'html',
    tags,
    fields,
  });
}
```

Add the import at the top: `import { htmlToText } from '../index/html-extract.ts';`

In `buildInitial`, after the markdown `queue` is built and BEFORE `this.total = files.length`, gather HTML files and fold them into the same pipeline. Replace the block that computes `files`/`queue`/`total` so both types are handled:

```ts
const mdFiles = this.app.vault.getMarkdownFiles();
const htmlFiles = this.settings.indexHtml
  ? this.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === 'html')
  : [];
const allFiles = [...mdFiles, ...htmlFiles];
const present = new Set(allFiles.map((f) => f.path));
for (const path of this.index.livePaths()) {
  if (!present.has(path)) this.index.tombstone(path);
}

const queue = allFiles.filter((f) => {
  const id = this.index.getIdByPath(f.path);
  const d = id !== undefined ? this.index.docEntry(id) : undefined;
  return !d || d.mtime !== f.stat.mtime || d.size !== f.stat.size;
});
queue.sort((a, b) => b.stat.mtime - a.stat.mtime);

this.total = allFiles.length;
this.indexed = allFiles.length - queue.length;
```

And in the `worker` loop, dispatch by extension:

```ts
try {
  if (file.extension.toLowerCase() === 'html') await this.indexHtmlFile(file);
  else await this.indexFile(file);
} catch (e) {
  console.warn('Sonar: failed to index', file.path, e);
}
```

- [ ] **Step 4: Wire incremental HTML events (Attention point #4)**

`metadataCache.on('changed')` fires for markdown only, so HTML needs `vault.on('modify')`. In `start()`, add after the existing `meta.on('changed', …)` registration:

```ts
registerEvent(
  vault.on('modify', (file) => {
    if (file instanceof TFile && file.extension.toLowerCase() === 'html' && this.settings.indexHtml) {
      this.onChanged(file.path);
    }
  }),
);
registerEvent(
  vault.on('create', (file) => {
    if (file instanceof TFile && file.extension.toLowerCase() === 'html' && this.settings.indexHtml) {
      this.onChanged(file.path);
    }
  }),
);
```

Extend the existing `rename` handler so renamed HTML re-indexes (it currently only re-adds `.md`):

```ts
registerEvent(
  vault.on('rename', (file, oldPath) => {
    this.onDeleted(oldPath);
    if (file instanceof TFile) {
      const ext = file.extension.toLowerCase();
      if (ext === 'md' || (ext === 'html' && this.settings.indexHtml)) this.onChanged(file.path);
    }
  }),
);
```

Update `reindexPath` to route HTML through `indexHtmlFile`:

```ts
private async reindexPath(path: string): Promise<void> {
  const file = this.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;
  const ext = file.extension.toLowerCase();
  if (ext === 'md') {
    await this.indexFile(file);
    this.scheduleSave();
  } else if (ext === 'html' && this.settings.indexHtml) {
    await this.indexHtmlFile(file);
    this.scheduleSave();
  }
}
```

(The `delete` handler already tombstones any `TFile` path — no change needed.)

- [ ] **Step 5: Typecheck + full test suite**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS (no regressions; new settings test green).

- [ ] **Step 6: Commit**

```bash
git add src/settings.ts src/settings.test.ts src/index/serialize.ts src/service/search-service.ts
git commit -m "feat(service): native HTML content indexing with incremental updates"
```

---

### Task 7: Configurable body fuzzy

**Files:**
- Modify: `src/settings.ts` (`bodyFuzzy` mode)
- Modify: `src/settings.test.ts`
- Modify: `src/index/search-core.ts` (gate driven by option)
- Modify: `src/index/search-core.test.ts`
- Modify: `src/service/search-service.ts` (pass `bodyFuzzy` from settings into `search`)

**Interfaces:**
- Produces: `type BodyFuzzy = 'off' | 'on-sparse' | 'always'`; `SearchOptions.bodyFuzzy?: BodyFuzzy` (default `'on-sparse'` preserves current behavior).

- [ ] **Step 1: Add the setting (test first)**

In `src/settings.test.ts`:

```ts
it('defaults bodyFuzzy to on-sparse and rejects unknown values', () => {
  expect(parseSettings({}).bodyFuzzy).toBe('on-sparse');
  expect(parseSettings({ bodyFuzzy: 'always' }).bodyFuzzy).toBe('always');
  expect(parseSettings({ bodyFuzzy: 'nonsense' }).bodyFuzzy).toBe('on-sparse');
});
```

Run: `pnpm vitest run src/settings.test.ts` → FAIL.

In `src/settings.ts`:
- Add `export type BodyFuzzy = 'off' | 'on-sparse' | 'always';`
- Add to interface: `/** When body Levenshtein fuzzy fires. */ bodyFuzzy: BodyFuzzy;`
- Add to `DEFAULT_SETTINGS`: `bodyFuzzy: 'on-sparse',`
- In `parseSettings`, add: `const bf = d.bodyFuzzy; ` then in the return: `bodyFuzzy: bf === 'off' || bf === 'always' ? bf : DEFAULT_SETTINGS.bodyFuzzy,`

Run again → PASS.

- [ ] **Step 2: Write the failing search-core test**

In `src/index/search-core.test.ts`, add (adapt the index-building helper already used in that file):

```ts
it('bodyFuzzy "off" suppresses the fuzzy fallback on a typo', () => {
  // Build an index containing "gravity" only; query the typo "graviti".
  const index = buildIndexWith(['gravity framework']); // use the file's existing helper
  const off = search(index, 'graviti', { now: 0, bodyFuzzy: 'off' });
  expect(off).toHaveLength(0);
  const sparse = search(index, 'graviti', { now: 0, bodyFuzzy: 'on-sparse' });
  expect(sparse.length).toBeGreaterThan(0);
});
```

> If `search-core.test.ts` has no reusable index builder, construct the index inline the same way the neighbouring tests in that file do (via `InvertedIndex` + `extractFields`). Match the existing test's construction pattern exactly.

Run: `pnpm vitest run src/index/search-core.test.ts` → FAIL (`bodyFuzzy` unknown / fallback still fires).

- [ ] **Step 3: Gate the fuzzy fallback on the mode**

In `src/index/search-core.ts`:
- Add to `interface SearchOptions`: `bodyFuzzy?: 'off' | 'on-sparse' | 'always';`
- Replace the fallback condition. Change:

```ts
  // Fuzzy fallback: only when strong matching is sparse.
  if (scored.length < FUZZY_MIN) {
```

to:

```ts
  // Fuzzy fallback, gated by mode: off = never; on-sparse = only when results
  // are sparse (default); always = run every query (fuzzyWeight contains noise).
  const fuzzyMode = opts.bodyFuzzy ?? 'on-sparse';
  const wantFuzzy =
    fuzzyMode === 'always' || (fuzzyMode === 'on-sparse' && scored.length < FUZZY_MIN);
  if (wantFuzzy) {
```

- [ ] **Step 4: Thread the setting through the service**

In `src/service/search-service.ts`:
- Add `bodyFuzzy?: 'off' | 'on-sparse' | 'always';` to `interface QueryOptions`.
- In `query()`, pass it into `search(...)`:

```ts
    const results = search(this.index, raw, {
      limit: opts.limit,
      now: opts.now,
      titleOnly: opts.titleOnly,
      pathFilters: opts.pathFilters,
      tagFilters: opts.tagFilters,
      minMtime: opts.minMtime,
      bodyFuzzy: this.settings.bodyFuzzy,
    });
```

(`KeywordProvider` needs no change — it calls `service.query`, which now reads the setting directly.)

- [ ] **Step 5: Typecheck + full test suite + commit**

```bash
pnpm typecheck && pnpm vitest run
git add src/settings.ts src/settings.test.ts src/index/search-core.ts src/index/search-core.test.ts src/service/search-service.ts
git commit -m "feat: configurable body fuzzy (off / on-sparse / always)"
```

---

### Task 8: Settings UI

**Files:**
- Modify: `src/settings-tab.ts`

**Interfaces:**
- Consumes: `SonarSettings.indexHtml`, `SonarSettings.bodyFuzzy`.

- [ ] **Step 1: Add the two controls**

In `src/settings-tab.ts`, following the existing `new Setting(containerEl)…` pattern used for `indexPdf`, add (place near the attachment settings and the ranking/debug section respectively):

```ts
new Setting(containerEl)
  .setName('Index HTML content')
  .setDesc('Search inside .html files (e.g. generated artifacts). Rebuild the index after changing.')
  .addToggle((t) =>
    t.setValue(this.plugin.settings.indexHtml).onChange(async (v) => {
      this.plugin.settings.indexHtml = v;
      await this.plugin.saveSettings();
    }),
  );

new Setting(containerEl)
  .setName('Body fuzzy matching')
  .setDesc('When typo-tolerant fuzzy runs over note bodies. "On when sparse" is the default.')
  .addDropdown((d) =>
    d
      .addOption('off', 'Off')
      .addOption('on-sparse', 'On when sparse')
      .addOption('always', 'Always')
      .setValue(this.plugin.settings.bodyFuzzy)
      .onChange(async (v) => {
        this.plugin.settings.bodyFuzzy = v as 'off' | 'on-sparse' | 'always';
        await this.plugin.saveSettings();
      }),
  );
```

> Match the actual accessor the file uses (`this.plugin.settings` + `this.plugin.saveSettings()`); if the existing code awaits a differently-named save method, use that exact name.

- [ ] **Step 2: Typecheck + build + commit**

```bash
pnpm typecheck && pnpm build
git add src/settings-tab.ts
git commit -m "feat(ui): settings for HTML indexing and body-fuzzy mode"
```

Expected: `pnpm build` completes (typecheck + esbuild) with no errors.

---

### Task 9: Wire the file finder into the plugin + full verification — Attention point #1 (RRF order)

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `FileCatalog` (Task 4), `FileFinderProvider` (Task 5).

- [ ] **Step 1: Construct the catalog and register the provider AFTER KeywordProvider**

In `src/main.ts`:
- Imports: `import { FileCatalog } from './service/file-catalog.ts';` and `import { FileFinderProvider } from './service/file-finder-provider.ts';`
- Add a field: `private fileCatalog!: FileCatalog;`
- In `onload`, after `this.registry.register(new KeywordProvider(this.service));`:

```ts
this.fileCatalog = new FileCatalog(this.app);
// Register AFTER KeywordProvider so the keyword list is the first list into
// RRF: when the same path matches by content AND by name, the deduped item
// kept is the keyword result (which carries the excerpt). Attention point #1.
this.registry.register(new FileFinderProvider(this.fileCatalog));
```

- [ ] **Step 2: Build and maintain the catalog on vault events**

In `onload`, after `this.service.start(...)`, register catalog maintenance:

```ts
this.app.workspace.onLayoutReady(() => this.fileCatalog.build());
this.registerEvent(
  this.app.vault.on('create', (f) => {
    if (f instanceof TFile) this.fileCatalog.add(f);
  }),
);
this.registerEvent(
  this.app.vault.on('delete', (f) => this.fileCatalog.remove(f.path)),
);
this.registerEvent(
  this.app.vault.on('rename', (f, oldPath) => {
    if (f instanceof TFile) this.fileCatalog.rename(oldPath, f);
  }),
);
this.registerEvent(
  this.app.vault.on('modify', (f) => {
    if (f instanceof TFile) this.fileCatalog.add(f); // refresh mtime
  }),
);
```

Add `TFile` to the existing `obsidian` import in `main.ts` if not already imported.

- [ ] **Step 3: Build and deploy to the vault**

Run: `cd ~/Dev\ Projects/obsidian-sonar && pnpm build`
Expected: typecheck + esbuild succeed; `main.js` is written into `/Users/mariomiletta/Vaults/marioverse.ai/.obsidian/plugins/sonar` (per `.obsidian-plugin-dir`; the build writes the fresh bundle there — do not copy a stale `main.js`).

- [ ] **Step 4: Reload the plugin and rebuild the index in Obsidian**

Use obsidian-cli (see the `obsidian-cli` skill) to reload the Sonar plugin and trigger the "Rebuild index" command, or reload Obsidian manually. The rebuild is required because `SCHEMA_VERSION` bumped to 2.

- [ ] **Step 5: Manual verification of all three features**

Open the Sonar modal in the vault and confirm:
1. **File finder** — type `srvc` (or a scattered subsequence of a known non-md filename); a non-markdown file appears with its type icon.
2. **File finder — non-content type** — search a `.canvas` or image basename; it appears with the correct icon (`layout-dashboard` / `image`).
3. **HTML content** — search a distinctive phrase that exists ONLY inside a file in `Resources/_artifacts/*.html`; the HTML file appears as a content match with an excerpt.
4. **Body fuzzy** — Settings → set "Body fuzzy" to `Always`; a typo query still returns results. Set to `Off`; the same typo returns fewer/none. Restore to `On when sparse`.
5. **Dedup** — a file that matches both by name and content appears exactly once.

Capture a screenshot of the modal showing a mixed result set (an HTML content hit + a non-md file-finder hit) for the record.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat: register universal file finder; maintain catalog on vault events"
```

- [ ] **Step 7: Update README**

Add to `README.md` Features: universal fuzzy file finder (all file types), native HTML content indexing, and the configurable body-fuzzy setting. Commit:

```bash
git add README.md
git commit -m "docs: document file finder, HTML indexing, body-fuzzy setting"
```

---

## Self-Review

**Spec coverage:**
- Universal file finder → Tasks 1, 4, 5, 9. ✓
- Per-type icons → Task 3. ✓
- Native HTML content → Tasks 2, 6. ✓
- Dual fuzzy (subsequence names + configurable body) → Tasks 1/5 (names) + Task 7 (body). ✓
- DocType html, ProviderResult.ext → Task 3. ✓
- SCHEMA_VERSION bump → Task 6. ✓
- Settings (indexHtml, bodyFuzzy) → Tasks 6, 7, 8. ✓
- Attention #1 (RRF dedup/order) → Task 9 Step 1 (register after KeywordProvider; RRF dedup pre-exists). ✓
- Attention #2 (short-query noise) → Task 4 (`minScore: 2`) + Task 5 (blank-query guard). ✓
- Attention #3 (isDesktopOnly false) → Global Constraints; no deps added. ✓
- Attention #4 (HTML incremental via vault.on) → Task 6 Step 4. ✓
- Out of scope (pdf.js/OCR, filter UI, catalog persistence) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code. Two "match the existing pattern" notes (search-core test helper, settings save accessor) point at concrete existing code, not vague instructions.

**Type consistency:** `DocType` widened once (Task 3) and consumed by Tasks 5/6. `ProviderResult.ext?` added Task 3, produced Task 5, consumed Task 3 renderer. `BodyFuzzy` union identical across settings.ts, search-core.ts, search-service.ts, settings-tab.ts. `FileRecord`/`FileHit`/`searchCatalog`/`FileCatalog` signatures consistent Tasks 4→5→9. `iconFor(ext, docType)` signature consistent Tasks 3→3-renderer.
