import type { KeywordHit } from './search-service.ts';
import type { SonarSearchHit } from '../types.ts';

/** Excerpt text for a hit, or '' when none was built (e.g. the file read
 *  failed). Shared so the HTTP `/search` endpoint and the public `search()`
 *  API derive the same fallback instead of duplicating the `?? ''`. */
export function hitExcerptText(hit: KeywordHit): string {
  return hit.excerpt?.text ?? '';
}

/** Minimal public shape for cross-plugin consumers (e.g. Exo) — no internal
 *  ranking or provider fields, just enough to display and open a result. */
export function toSonarSearchHit(hit: KeywordHit): SonarSearchHit {
  return {
    path: hit.path,
    title: hit.basename,
    score: hit.score,
    excerpt: hitExcerptText(hit),
  };
}
