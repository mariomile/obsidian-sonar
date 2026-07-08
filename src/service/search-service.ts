import { type App, type CachedMetadata, type EventRef, TFile } from 'obsidian';
import { InvertedIndex } from '../index/inverted-index.ts';
import { extractFields, stripFrontmatter, type NoteMeta } from '../index/field-extract.ts';
import { htmlToText } from '../index/html-extract.ts';
import { search, excerptWeights, type SearchResult } from '../index/search-core.ts';
import { makeExcerpt } from '../index/excerpt.ts';
import { encodeIndex, decodeIndex, SCHEMA_VERSION } from '../index/serialize.ts';
import { TOKENIZER_VERSION } from '../index/tokenizer.ts';
import type { Excerpt } from '../types.ts';
import type { SonarSettings } from '../settings.ts';
import type { Extractor } from './extractor.ts';

export interface KeywordHit extends SearchResult {
  excerpt?: Excerpt;
}

export interface IndexStatus {
  ready: boolean;
  indexed: number;
  total: number;
}

export interface QueryOptions {
  limit: number;
  now: number;
  signal?: AbortSignal;
  titleOnly?: boolean;
  pathFilters?: string[];
  tagFilters?: string[];
  minMtime?: number;
}

/** Max markdown chars fed to the preview renderer (avoids rendering huge notes). */
const PREVIEW_CHARS = 4000;
const DEBOUNCE_MS = 400;
const SAVE_DEBOUNCE_MS = 10_000;
const SLICE_MS = 12;
const COMPACT_MIN = 2_000;
/** Guard against a single file read hanging the whole build. */
const READ_TIMEOUT_MS = 5_000;
/** Parallel file reads during the initial build (I/O-bound → concurrency helps). */
const READ_CONCURRENCY = 12;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Resolve `p`, or reject after `ms` — so one stuck read can't stall indexing. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Map an Obsidian metadata cache into the pure NoteMeta shape. */
function toNoteMeta(cache: CachedMetadata | null): NoteMeta {
  if (!cache) return {};
  return {
    headings: cache.headings?.map((h) => ({ heading: h.heading, level: h.level })),
    tags: cache.tags?.map((t) => t.tag),
    frontmatter: cache.frontmatter,
  };
}

/**
 * Owns the search index and its lifecycle inside Obsidian: initial build,
 * incremental updates on vault events, the on-disk cache, and query execution
 * (ranking + excerpt generation). All ranking logic lives in the pure
 * `src/index` modules; this class is the Obsidian boundary.
 */
export class SearchService {
  readonly index = new InvertedIndex();
  private ready = false;
  private indexed = 0;
  private total = 0;

  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<string, 'change' | 'delete'>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly progressListeners = new Set<(status: IndexStatus) => void>();

  extractor: Extractor | null = null;

  constructor(
    private readonly app: App,
    private readonly settings: SonarSettings,
    private readonly cacheDir: string | undefined,
  ) {}

  getStatus(): IndexStatus {
    return { ready: this.ready, indexed: this.indexed, total: this.total };
  }

  onProgress(cb: (status: IndexStatus) => void): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  private emitProgress(): void {
    const status = this.getStatus();
    for (const cb of this.progressListeners) cb(status);
  }

  /** Register vault events and kick off the initial build at layout-ready. */
  start(registerEvent: (ref: EventRef) => void): void {
    const meta = this.app.metadataCache;
    const vault = this.app.vault;
    registerEvent(
      meta.on('changed', (file) => {
        if (file instanceof TFile && file.extension === 'md') this.onChanged(file.path);
      }),
    );
    // HTML has no metadata cache, so it needs raw vault create/modify events.
    registerEvent(
      vault.on('create', (file) => {
        if (
          file instanceof TFile &&
          file.extension.toLowerCase() === 'html' &&
          this.settings.indexHtml
        ) {
          this.onChanged(file.path);
        }
      }),
    );
    registerEvent(
      vault.on('modify', (file) => {
        if (
          file instanceof TFile &&
          file.extension.toLowerCase() === 'html' &&
          this.settings.indexHtml
        ) {
          this.onChanged(file.path);
        }
      }),
    );
    registerEvent(
      vault.on('delete', (file) => {
        if (file instanceof TFile) this.onDeleted(file.path);
      }),
    );
    registerEvent(
      vault.on('rename', (file, oldPath) => {
        this.onDeleted(oldPath);
        if (file instanceof TFile) {
          const ext = file.extension.toLowerCase();
          if (ext === 'md' || (ext === 'html' && this.settings.indexHtml)) this.onChanged(file.path);
        }
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      void this.buildInitial();
    });
  }

  private onChanged(path: string): void {
    if (!this.ready) {
      this.pending.set(path, 'change');
      return;
    }
    this.debounce(path, () => void this.reindexPath(path));
  }

  private onDeleted(path: string): void {
    if (!this.ready) {
      this.pending.set(path, 'delete');
      return;
    }
    this.index.tombstone(path);
    this.scheduleSave();
  }

  private debounce(path: string, fn: () => void): void {
    const existing = this.debounceTimers.get(path);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      path,
      setTimeout(() => {
        this.debounceTimers.delete(path);
        fn();
      }, DEBOUNCE_MS),
    );
  }

  private async buildInitial(): Promise<void> {
    await this.loadCache();

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
    queue.sort((a, b) => b.stat.mtime - a.stat.mtime); // recently modified first

    this.total = allFiles.length;
    this.indexed = allFiles.length - queue.length;
    this.emitProgress();

    // Read files with bounded concurrency. This keeps wall-clock low when reads
    // are I/O-bound (e.g. iCloud files that must download on first read): many
    // fetches proceed in parallel instead of serializing. Index mutation stays
    // safe because JS is single-threaded — addDocument runs to completion
    // between awaits.
    let cursor = 0;
    let sliceStart = performance.now();
    const worker = async (): Promise<void> => {
      while (cursor < queue.length) {
        const file = queue[cursor++]!;
        try {
          if (file.extension.toLowerCase() === 'html') await this.indexHtmlFile(file);
          else await this.indexFile(file);
        } catch (e) {
          console.warn('Sonar: failed to index', file.path, e);
        }
        this.indexed++;
        if (performance.now() - sliceStart > SLICE_MS) {
          this.emitProgress();
          await sleep(0);
          sliceStart = performance.now();
        }
      }
    };
    await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));

    this.ready = true;
    this.emitProgress();
    await this.flushPending();

    if (this.extractor) void this.extractor.run();
    this.scheduleSave();
  }

  private async flushPending(): Promise<void> {
    const items = [...this.pending];
    this.pending.clear();
    for (const [path, kind] of items) {
      if (kind === 'delete') this.index.tombstone(path);
      else await this.reindexPath(path);
    }
  }

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

  private async indexFile(file: TFile): Promise<void> {
    let content = '';
    try {
      content = await withTimeout(this.app.vault.cachedRead(file), READ_TIMEOUT_MS);
    } catch {
      return;
    }
    const meta = toNoteMeta(this.app.metadataCache.getFileCache(file));
    const { fields, tags } = extractFields({ basename: file.basename, content, meta });
    if (this.index.getIdByPath(file.path) !== undefined) this.index.tombstone(file.path);
    this.index.addDocument({
      path: file.path,
      basename: file.basename,
      mtime: file.stat.mtime,
      size: file.stat.size,
      docType: 'md',
      tags,
      fields,
    });
  }

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

  /** Run a search and attach an excerpt to each hit (reads live file text). */
  async query(raw: string, opts: QueryOptions): Promise<KeywordHit[]> {
    const results = search(this.index, raw, {
      limit: opts.limit,
      now: opts.now,
      titleOnly: opts.titleOnly,
      pathFilters: opts.pathFilters,
      tagFilters: opts.tagFilters,
      minMtime: opts.minMtime,
    });
    const hits: KeywordHit[] = [];
    for (const r of results) {
      if (opts.signal?.aborted) break;
      hits.push({ ...r, excerpt: await this.buildExcerpt(r) });
    }
    return hits;
  }

  /** Most recently modified live docs (for the empty-query browse view). */
  recent(
    limit: number,
    filters?: { pathFilters?: string[]; tagFilters?: string[]; minMtime?: number },
  ): SearchResult[] {
    const paths = filters?.pathFilters ?? [];
    const tags = filters?.tagFilters ?? [];
    const minMtime = filters?.minMtime;
    return this.index
      .liveEntries()
      .filter(({ entry }) => {
        if (minMtime !== undefined && entry.mtime < minMtime) return false;
        if (paths.length > 0) {
          const foldedPath = entry.path.toLowerCase();
          if (!paths.every((p) => foldedPath.includes(p))) return false;
        }
        if (tags.length > 0) {
          if (!tags.every((t) => entry.tags.some((tag) => tag.startsWith(t)))) return false;
        }
        return true;
      })
      .sort((a, b) => b.entry.mtime - a.entry.mtime)
      .slice(0, limit)
      .map(({ docId, entry }) => ({
        docId,
        path: entry.path,
        basename: entry.basename,
        docType: entry.docType,
        tags: entry.tags,
        mtime: entry.mtime,
        score: 0,
        matched: [],
      }));
  }

  /** Sorted list of every tag in the index (for the tag filter chip). */
  allTags(): string[] {
    const set = new Set<string>();
    for (const { entry } of this.index.liveEntries()) for (const t of entry.tags) set.add(t);
    return [...set].sort();
  }

  /**
   * Raw markdown for the preview pane (frontmatter stripped, capped), so the
   * modal can render it formatted. Non-markdown docs return their extracted
   * text (rendered as a plain paragraph).
   */
  async previewMarkdown(path: string): Promise<string | undefined> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return undefined;
    if (file.extension === 'md') {
      try {
        return stripFrontmatter(await this.app.vault.cachedRead(file)).trimStart().slice(0, PREVIEW_CHARS);
      } catch {
        return undefined;
      }
    }
    if (file.extension.toLowerCase() === 'html') {
      try {
        return htmlToText(await this.app.vault.cachedRead(file)).text.slice(0, PREVIEW_CHARS);
      } catch {
        return undefined;
      }
    }
    return this.extractor?.cachedText(path)?.slice(0, PREVIEW_CHARS);
  }

  private async buildExcerpt(r: SearchResult): Promise<Excerpt | undefined> {
    let text: string | undefined;
    if (r.docType === 'md') {
      const file = this.app.vault.getAbstractFileByPath(r.path);
      if (file instanceof TFile) {
        try {
          // Strip the YAML block so excerpts show prose, not frontmatter.
          text = stripFrontmatter(await this.app.vault.cachedRead(file));
        } catch {
          text = undefined;
        }
      }
    } else if (r.docType === 'html') {
      const file = this.app.vault.getAbstractFileByPath(r.path);
      if (file instanceof TFile) {
        try {
          text = htmlToText(await this.app.vault.cachedRead(file)).text;
        } catch {
          text = undefined;
        }
      }
    } else if (this.extractor) {
      text = this.extractor.cachedText(r.path);
    }
    if (!text) return undefined;
    return makeExcerpt(text, r.matched, { weights: excerptWeights(this.index, r.matched) });
  }

  // ---- cache ----

  private cachePath(): string | null {
    return this.cacheDir ? `${this.cacheDir}/index.bin` : null;
  }

  private async loadCache(): Promise<void> {
    const path = this.cachePath();
    if (!path) return;
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(path))) return;
      const buf = await adapter.readBinary(path);
      const decoded = decodeIndex(buf);
      if (!decoded) return;
      if (decoded.schemaVersion !== SCHEMA_VERSION || decoded.tokenizerVersion !== TOKENIZER_VERSION) {
        return; // stale format → full rebuild
      }
      this.index.loadSnapshot(decoded.snapshot);
    } catch (e) {
      console.warn('Sonar: failed to load index cache', e);
    }
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveCache();
    }, SAVE_DEBOUNCE_MS);
  }

  private async saveCache(): Promise<void> {
    const path = this.cachePath();
    if (!path) return;
    try {
      const threshold = Math.max(COMPACT_MIN, this.index.docCount * 0.2);
      if (this.index.tombstoneCount > threshold) this.index.compact();
      const buf = encodeIndex(this.index, SCHEMA_VERSION, TOKENIZER_VERSION);
      await this.app.vault.adapter.writeBinary(path, buf);
    } catch (e) {
      console.warn('Sonar: failed to save index cache', e);
    }
  }

  /** Rebuild the whole index from scratch (settings-tab action). */
  async rebuild(): Promise<void> {
    this.ready = false;
    this.index.loadSnapshot({ docs: [], terms: [] });
    await this.buildInitial();
  }

  dispose(): void {
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    void this.saveCache();
  }
}
