import { describe, expect, it } from 'vitest';
import { toSonarSearchHit } from './hit-mapping.ts';
import type { KeywordHit } from './search-service.ts';

const hit = (path: string, basename: string): KeywordHit => ({
  docId: 0, path, basename, docType: 'md', tags: [], mtime: 0, score: 1, matched: [],
});

describe('toSonarSearchHit', () => {
  it('titles a hub note (context.md) by its folder', () => {
    expect(toSonarSearchHit(hit('Projects/DeepAgent/context.md', 'context')).title).toBe('DeepAgent');
  });

  it('keeps the basename for an ordinary note', () => {
    expect(toSonarSearchHit(hit('Notes/Pricing.md', 'Pricing')).title).toBe('Pricing');
  });
});
