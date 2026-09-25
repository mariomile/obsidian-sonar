import type { SearchService } from './search-service.ts';
import type { SonarSearchHit } from '../types.ts';
import { toSonarSearchHit } from './hit-mapping.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** How long `search()` waits for the initial index build before querying
 *  whatever is ready — bounds the worst case for a caller that asks right
 *  after Obsidian starts, without blocking indefinitely on a huge vault. */
const READY_TIMEOUT_MS = 3_000;

/** Resolve once the index is ready, or after `timeoutMs` — whichever first.
 *  Uses `SearchService.onProgress` rather than polling. */
function waitUntilReady(service: SearchService, timeoutMs: number): Promise<void> {
  if (service.getStatus().ready) return Promise.resolve();
  return new Promise((resolve) => {
    const settle = (): void => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(settle, timeoutMs);
    const unsubscribe = service.onProgress((status) => {
      if (status.ready) settle();
    });
  });
}

/**
 * Public cross-plugin search: waits (bounded) for the index to be ready, runs
 * a query, and maps hits to the minimal `SonarSearchHit` shape. This is the
 * implementation behind `SonarPlugin.search()`; it's kept free of the
 * `Plugin`/`App` dependency so it can be unit-tested against a plain
 * `SearchService`.
 */
export async function publicSearch(
  service: SearchService,
  query: string,
  opts?: { limit?: number },
): Promise<SonarSearchHit[]> {
  if (!query.trim()) return [];
  const limit = Math.min(Math.max(1, opts?.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  await waitUntilReady(service, READY_TIMEOUT_MS);
  const hits = await service.query(query, { limit, now: Date.now() });
  return hits.map(toSonarSearchHit);
}
