import type { DocType } from './index/fields.ts';

/** A highlight span [start, end) into an excerpt's text. */
export type HighlightRange = [number, number];

export interface Excerpt {
  text: string;
  ranges: HighlightRange[];
}

/** A single result surfaced by a provider, ready for the modal to render. */
export interface ProviderResult {
  path: string;
  basename: string;
  docType: DocType;
  score: number;
  /** Provider id this result came from. */
  source: string;
  matched: string[];
  excerpt?: Excerpt;
}

/**
 * A pluggable search backend. v1 ships one (keyword); Wave 2 adds a QMD
 * semantic provider. `instant` providers run on every query; `deep` providers
 * run after a typing pause and can be cancelled via the AbortSignal.
 */
export interface SearchProvider {
  id: string;
  label: string;
  mode: 'instant' | 'deep';
  /** Whether results merge into the main ranked list (true) or show as their
   *  own labeled section (false). */
  fused: boolean;
  isAvailable(): boolean;
  search(raw: string, opts: ProviderSearchOptions): Promise<ProviderResult[]>;
}

export interface ProviderSearchOptions {
  limit: number;
  now: number;
  signal: AbortSignal;
  /** Restrict to title fields (keyword provider only). */
  titleOnly?: boolean;
  /** Folded path substrings a result must contain (folder chip). */
  pathFilters?: string[];
  /** Folded tag prefixes a result must carry (tag chip). */
  tagFilters?: string[];
  /** Only include docs modified at or after this epoch ms (date chip). */
  minMtime?: number;
}

/** A group of results from one provider, for section rendering. */
export interface ProviderSection {
  providerId: string;
  label: string;
  fused: boolean;
  results: ProviderResult[];
}
