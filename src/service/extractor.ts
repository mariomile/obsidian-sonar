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

/**
 * Indexes text extracted from PDFs and images via the Text Extractor plugin,
 * when installed. Extracted text flows into the same index as markdown (BODY
 * field), so ranking is unaware extraction happened. Runs at low priority after
 * the markdown build; failures are remembered to avoid retry loops.
 */
export class Extractor {
  private readonly textCache = new Map<string, string>();
  private readonly skip = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly settings: SonarSettings,
    private readonly index: InvertedIndex,
    private readonly onIndexed: () => void,
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

  private wantedExtensions(): string[] {
    const exts: string[] = [];
    if (this.settings.indexPdf) exts.push('pdf');
    if (this.settings.indexImages) exts.push(...IMAGE_EXTS);
    return exts;
  }

  async run(): Promise<void> {
    const api = this.api();
    if (!api) return;
    const exts = this.wantedExtensions();
    if (exts.length === 0) return;

    const cap = this.settings.maxAttachmentMB * 1024 * 1024;
    const files = this.app.vault
      .getFiles()
      .filter(
        (f) =>
          exts.includes(f.extension.toLowerCase()) &&
          f.stat.size <= cap &&
          !this.skip.has(f.path) &&
          this.index.getIdByPath(f.path) === undefined,
      );

    let cursor = 0;
    let didIndex = false;
    const worker = async (): Promise<void> => {
      while (cursor < files.length) {
        const file = files[cursor++]!;
        if (await this.extractOne(api, file)) didIndex = true;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (didIndex) this.onIndexed();
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
}
