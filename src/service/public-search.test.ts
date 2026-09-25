import { describe, it, expect, vi } from 'vitest';
import { publicSearch } from './public-search.ts';
import type { IndexStatus, KeywordHit, SearchService } from './search-service.ts';

function hit(overrides: Partial<KeywordHit> = {}): KeywordHit {
  return {
    docId: 1,
    path: 'a.md',
    basename: 'a',
    docType: 'md',
    tags: [],
    mtime: 0,
    score: 1,
    matched: ['a'],
    excerpt: { text: 'hello world', ranges: [] },
    ...overrides,
  };
}

/** Fake matching the slice of `SearchService` `publicSearch` uses, so this
 *  stays a headless unit test (no Obsidian `App`/`Plugin`). */
function fakeService(opts: { ready: boolean; hits?: KeywordHit[] }) {
  let ready = opts.ready;
  const listeners = new Set<(status: IndexStatus) => void>();
  const query = vi.fn(async () => opts.hits ?? []);
  const service = {
    getStatus: () => ({ ready, indexed: 0, total: 0, skipped: 0 }),
    onProgress: (cb: (status: IndexStatus) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    query,
  } as unknown as SearchService;
  const emitReady = () => {
    ready = true;
    for (const cb of listeners) cb({ ready: true, indexed: 1, total: 1, skipped: 0 });
  };
  return { service, query, emitReady };
}

describe('publicSearch', () => {
  it('returns [] for an empty/whitespace query without touching the index', async () => {
    const { service, query } = fakeService({ ready: true, hits: [hit()] });
    expect(await publicSearch(service, '')).toEqual([]);
    expect(await publicSearch(service, '   ')).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('queries immediately when the index is already ready, mapped to the public hit shape', async () => {
    const { service, query } = fakeService({ ready: true, hits: [hit()] });
    const out = await publicSearch(service, 'a');
    expect(query).toHaveBeenCalledWith('a', expect.objectContaining({ limit: 20 }));
    expect(out).toEqual([{ path: 'a.md', title: 'a', score: 1, excerpt: 'hello world' }]);
  });

  it('maps a hit with no excerpt to an empty string rather than throwing', async () => {
    const { service } = fakeService({ ready: true, hits: [hit({ excerpt: undefined })] });
    const out = await publicSearch(service, 'a');
    expect(out).toEqual([{ path: 'a.md', title: 'a', score: 1, excerpt: '' }]);
  });

  it('waits for the index to become ready before querying', async () => {
    vi.useFakeTimers();
    try {
      const { service, query, emitReady } = fakeService({ ready: false, hits: [hit()] });
      const pending = publicSearch(service, 'a');

      await vi.advanceTimersByTimeAsync(500);
      expect(query).not.toHaveBeenCalled();

      emitReady();
      const out = await pending;
      expect(query).toHaveBeenCalledTimes(1);
      expect(out).toEqual([{ path: 'a.md', title: 'a', score: 1, excerpt: 'hello world' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up waiting after ~3s and queries anyway, returning whatever the service gives back', async () => {
    vi.useFakeTimers();
    try {
      const { service, query } = fakeService({ ready: false, hits: [] });
      const pending = publicSearch(service, 'a');

      await vi.advanceTimersByTimeAsync(3_000);
      const out = await pending;

      expect(query).toHaveBeenCalledTimes(1);
      expect(out).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults the limit to 20 and clamps a large limit to 100', async () => {
    const { service, query } = fakeService({ ready: true, hits: [] });
    await publicSearch(service, 'a');
    expect(query).toHaveBeenLastCalledWith('a', expect.objectContaining({ limit: 20 }));

    await publicSearch(service, 'a', { limit: 500 });
    expect(query).toHaveBeenLastCalledWith('a', expect.objectContaining({ limit: 100 }));
  });
});
