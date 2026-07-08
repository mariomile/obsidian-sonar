import { describe, it, expect } from 'vitest';
import { searchCatalog, minScoreFor, type FileRecord } from './file-catalog.ts';

const recs: FileRecord[] = [
  { path: 'src/service/search-service.ts', basename: 'search-service', ext: 'ts', mtime: 3 },
  { path: 'Atlas/People/Mario Miletta.md', basename: 'Mario Miletta', ext: 'md', mtime: 2 },
  { path: 'Resources/_artifacts/GTM Gravity.html', basename: 'GTM Gravity', ext: 'html', mtime: 1 },
];

describe('searchCatalog', () => {
  it('finds a file by scattered subsequence of its name', () => {
    const hits = searchCatalog(recs, 'srvc', { limit: 10 });
    expect(hits[0]!.basename).toBe('search-service');
  });

  it('excludes non-subsequence candidates', () => {
    const hits = searchCatalog(recs, 'zzz', { limit: 10 });
    expect(hits).toHaveLength(0);
  });

  it('respects the limit', () => {
    const hits = searchCatalog(recs, 'a', { limit: 1 });
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it('drops hits below minScore', () => {
    const hits = searchCatalog(recs, 'a', { limit: 10, minScore: 1000 });
    expect(hits).toHaveLength(0);
  });

  it('ties break by recency (mtime desc)', () => {
    const two: FileRecord[] = [
      { path: 'a/note.md', basename: 'note', ext: 'md', mtime: 1 },
      { path: 'b/note.md', basename: 'note', ext: 'md', mtime: 9 },
    ];
    const hits = searchCatalog(two, 'note', { limit: 10 });
    expect(hits[0]!.path).toBe('b/note.md');
  });
});

describe('minScoreFor', () => {
  it('demands a higher score for shorter queries', () => {
    expect(minScoreFor('a')).toBeGreaterThan(minScoreFor('ab'));
    expect(minScoreFor('ab')).toBeGreaterThan(minScoreFor('abc'));
    expect(minScoreFor('abc')).toBeGreaterThan(minScoreFor('abcd'));
    expect(minScoreFor('abcde')).toBe(minScoreFor('abcd'));
  });
});
