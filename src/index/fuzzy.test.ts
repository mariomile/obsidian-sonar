import { describe, expect, it } from 'vitest';
import { boundedLevenshtein, fuzzyCandidates } from './fuzzy.ts';

describe('boundedLevenshtein', () => {
  it('computes small edit distances', () => {
    expect(boundedLevenshtein('helo', 'hello', 2)).toBe(1);
    expect(boundedLevenshtein('cat', 'car', 2)).toBe(1);
    expect(boundedLevenshtein('kitten', 'sitting', 3)).toBe(3);
  });

  it('short-circuits when the length gap exceeds max', () => {
    expect(boundedLevenshtein('a', 'abcdef', 1)).toBe(2); // max+1
  });

  it('returns max+1 when distance exceeds the bound', () => {
    expect(boundedLevenshtein('abc', 'xyz', 1)).toBe(2);
  });
});

describe('fuzzyCandidates', () => {
  it('finds terms within the edit-distance bound, ranked by distance', () => {
    const terms = ['hello', 'help', 'world', 'held'];
    // helo→held, helo→hello, helo→help are all edit distance 1; sorted by
    // distance then alphabetically. 'world' is far.
    const out = fuzzyCandidates('helo', terms, 1);
    expect(out.map((m) => m.term)).toEqual(['held', 'hello', 'help']);
    expect(out[0]!.dist).toBe(1);
  });

  it('excludes the exact term itself', () => {
    const out = fuzzyCandidates('cat', ['cat', 'cats', 'car'], 1);
    expect(out.map((m) => m.term)).toEqual(['car', 'cats']);
  });

  it('respects the length band (cheap pre-filter)', () => {
    const out = fuzzyCandidates('cat', ['category', 'ca'], 1);
    expect(out.map((m) => m.term)).toEqual(['ca']);
  });
});
