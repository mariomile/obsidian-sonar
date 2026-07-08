import type { App, TFile } from 'obsidian';
import type { InvertedIndex } from '../index/inverted-index.ts';
import { extractFields } from '../index/field-extract.ts';
import type { DocType } from '../index/fields.ts';
import type { SonarSettings } from '../settings.ts';

/** The slice of the Text Extractor plugin API that Sonar consumes. */
interface TextExtractorApi {
  canFileBeExtracted(filePath: string): boolean;
  extractText(file: TFile): Promise<string>;
}

interface PluginsHost {
  plugins?: { plugins?: Record<string, { api?: TextExtractorApi }> };
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'];
const CONCURRENCY = 2;
const SAVE_DEBOUNCE_MS = 10_000;

/**
 * Indexes text extracted from PDFs and images via the Text Extractor plugin,
 * when installed. Extracted text flows into the same index as markdown (BODY
 * field), so ranking is unaware extraction happened. Runs at low priority after
 * the markdown build, then incrementally as attachments are added/changed.
 * Extracted text is persisted so previews/excerpts survive a reboot without
 * re-running the (slow) extraction.
 */
export class Extractor {
  private readonly textCache = new Map<string, string>();
  private readonly skip = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly app: App,
    private readonly settings: SonarSettings,
    private readonly index: InvertedIndex,
    private readonly onIndexed: () => void,
    private readonly cacheDir: string | undefined,
  ) {}

  private api(): TextExtractorApi | null {
    const host = this.app as unknown as PluginsHost;
    return host.plugins?.plugins?.['text-extractor']?.api ?? null;
  }

  isAvailable(): boolean {
    return this.api() !== null;
  }

  cachedText(path: string): string | undefined {
    return this.textCache.get(path);
  }

  /** Number of attachments that failed extraction this session. */
  skippedCount(): number {
    return this.skip.size;
  }

  private wantedExtensions(): string[] {
    const exts: string[] = [];
    if (this.settings.indexPdf) exts.push('pdf');
    if (this.settings.indexImages) exts.push(...IMAGE_EXTS);
    return exts;
  }

  /** Whether this file is an attachment type we should index (per settings). */
  private wants(file: TFile): boolean {
    const cap = this.settings.maxAttachmentMB * 1024 * 1024;
    return (
      this.wantedExtensions().includes(file.extension.toLowerCase()) &&
      file.stat.size <= cap &&
      !this.skip.has(file.path)
    );
  }

  /** Full pass: index every wanted attachment not already in the index. */
  async run(): Promise<void> {
    const api = this.api();
    if (!api) return;
    if (this.wantedExtensions().length === 0) return;

    const files = this.app.vault
      .getFiles()
      .filter((f) => this.wants(f) && this.index.getIdByPath(f.path) === undefined);

    let cursor = 0;
    let didIndex = false;
    const worker = async (): Promise<void> => {
      while (cursor < files.length) {
        const file = files[cursor++]!;
        if (await this.extractOne(api, file)) didIndex = true;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (didIndex) {
      this.onIndexed();
      this.scheduleSave();
    }
  }

  /** Incrementally (re)index a single attachment on create/modify/rename. */
  async extractFile(file: TFile): Promise<void> {
    const api = this.api();
    if (!api || !this.wants(file)) return;
    // On modify, mtime changes — re-extract; extractOne tombstones the old doc.
    if (await this.extractOne(api, file)) {
      this.onIndexed();
      this.scheduleSave();
    }
  }

  /** Forget cached text + skip state for a removed path. */
  remove(path: string): void {
    if (this.textCache.delete(path)) this.scheduleSave();
    this.skip.delete(path);
  }

  private async extractOne(api: TextExtractorApi, file: TFile): Promise<boolean> {
    try {
      if (!api.canFileBeExtracted(file.path)) return false;
      const text = await api.extractText(file);
      if (!text) return false;
      const docType: DocType = file.extension.toLowerCase() === 'pdf' ? 'pdf' : 'image';
      const { fields, tags } = extractFields({ basename: file.basename, content: text, meta: {} });
      if (this.index.getIdByPath(file.path) !== undefined) this.index.tombstone(file.path);
      this.index.addDocument({
        path: file.path,
        basename: file.basename,
        mtime: file.stat.mtime,
        size: file.stat.size,
        docType,
        tags,
        fields,
      });
      this.textCache.set(file.path, text);
      return true;
    } catch (e) {
      console.warn('Sonar: extraction failed for', file.path, e);
      this.skip.add(file.path);
      return false;
    }
  }

  // ---- persisted extracted text ----

  private path(): string | null {
    return this.cacheDir ? `${this.cacheDir}/attachments.json` : null;
  }

  /** Load persisted extracted text so previews/excerpts work without re-run. */
  async load(): Promise<void> {
    const path = this.path();
    if (!path) return;
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(path))) return;
      const raw = JSON.parse(await adapter.read(path)) as Record<string, string>;
      for (const [p, text] of Object.entries(raw)) {
        if (typeof text === 'string') this.textCache.set(p, text);
      }
    } catch (e) {
      console.warn('Sonar: failed to load attachment cache', e);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  private async save(): Promise<void> {
    const path = this.path();
    if (!path) return;
    try {
      const obj: Record<string, string> = {};
      for (const [p, text] of this.textCache) obj[p] = text;
      await this.app.vault.adapter.write(path, JSON.stringify(obj));
    } catch (e) {
      console.warn('Sonar: failed to save attachment cache', e);
    }
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.save();
    }
  }
}
