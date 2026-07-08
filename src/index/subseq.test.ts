import { describe, it, expect } from 'vitest';
import { subsequenceScore } from './subseq.ts';

describe('subsequenceScore', () => {
  it('returns null when not a subsequence', () => {
    expect(subsequenceScore('xyz', 'search-service')).toBeNull();
  });

  it('matches a scattered subsequence', () => {
    expect(subsequenceScore('srvc', 'search-service')).not.toBeNull();
  });

  it('ranks boundary/consecutive matches above scattered ones', () => {
    const boundary = subsequenceScore('ss', 'search-service')!; // two word-starts
    const scattered = subsequenceScore('ss', 'passes')!; // mid-word
    expect(boundary).toBeGreaterThan(scattered);
  });

  it('rewards a consecutive run over gaps', () => {
    const run = subsequenceScore('sear', 'search-service')!;
    // Non-boundary gaps (mid-word), so the only difference vs `run` is adjacency.
    const gappy = subsequenceScore('sear', 'sxexaxr')!;
    expect(run).toBeGreaterThan(gappy);
  });

  it('folds diacritics and case', () => {
    expect(subsequenceScore('perche', 'Perché note')).not.toBeNull();
    expect(subsequenceScore('MRIO', 'Mario Miletta')).not.toBeNull();
  });

  it('treats CamelCase transitions as boundaries', () => {
    const camel = subsequenceScore('ss', 'searchService')!;
    const mid = subsequenceScore('ss', 'passe')!;
    expect(camel).toBeGreaterThan(mid);
  });

  it('empty query returns null', () => {
    expect(subsequenceScore('', 'anything')).toBeNull();
  });

  it('an exact match outscores a prefix match', () => {
    expect(subsequenceScore('lean', 'lean')!).toBeGreaterThan(subsequenceScore('lean', 'lean canvas')!);
  });

  it('a prefix match outscores a scattered subsequence of the same query', () => {
    const prefix = subsequenceScore('lean', 'Lean Canvas')!;
    const scattered = subsequenceScore('lean', 'Long essay about numbers')!; // l..e..a..n scattered
    expect(prefix).toBeGreaterThan(scattered);
  });
});
