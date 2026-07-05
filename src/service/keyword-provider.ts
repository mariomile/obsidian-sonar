import type { ProviderResult, ProviderSearchOptions, SearchProvider } from '../types.ts';
import type { SearchService } from './search-service.ts';

/**
 * The v1 provider: wraps the in-plugin keyword engine. It's `instant` (runs on
 * every keystroke) and `fused` (its results are the main ranked list). Wave 2's
 * QMD provider will register alongside it as a `deep` provider.
 */
export class KeywordProvider implements SearchProvider {
  readonly id = 'keyword';
  readonly label = 'Vault';
  readonly mode = 'instant' as const;
  readonly fused = true;

  constructor(private readonly service: SearchService) {}

  isAvailable(): boolean {
    return true;
  }

  async search(raw: string, opts: ProviderSearchOptions): Promise<ProviderResult[]> {
    const hits = await this.service.query(raw, {
      limit: opts.limit,
      now: opts.now,
      signal: opts.signal,
      titleOnly: opts.titleOnly,
      pathFilters: opts.pathFilters,
      tagFilters: opts.tagFilters,
      minMtime: opts.minMtime,
    });
    return hits.map((h) => ({
      path: h.path,
      basename: h.basename,
      docType: h.docType,
      score: h.score,
      source: this.id,
      matched: h.matched,
      excerpt: h.excerpt,
    }));
  }
}
