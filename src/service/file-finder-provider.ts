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
  /** A filename match counts less than a content match at equal rank, so a
   *  strong keyword hit isn't tied by a loose subsequence name match. */
  readonly fuseWeight = 0.6;

  constructor(private readonly catalog: FileCatalog) {}

  isAvailable(): boolean {
    return true;
  }

  search(raw: string, opts: ProviderSearchOptions): Promise<ProviderResult[]> {
    const q = raw.trim();
    if (q.length === 0) return Promise.resolve([]);
    const results = this.catalog.search(q, opts.limit).map((h) => ({
      path: h.path,
      basename: h.basename,
      docType: docTypeFor(h.ext),
      ext: h.ext,
      score: h.score,
      source: this.id,
      matched: [] as string[],
    }));
    return Promise.resolve(results);
  }
}
