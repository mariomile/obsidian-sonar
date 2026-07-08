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
