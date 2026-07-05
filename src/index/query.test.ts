import { describe, expect, it } from 'vitest';
import { parseQuery } from './query.ts';

describe('parseQuery — plain terms & prefix', () => {
  it('marks the final token as a prefix while typing (no trailing space)', () => {
    const q = parseQuery('hello world');
    expect(q.terms).toEqual([
      { term: 'hello', prefix: false },
      { term: 'world', prefix: true },
    ]);
  });

  it('treats a completed word (trailing space) as exact, not prefix', () => {
    const q = parseQuery('hello world ');
    expect(q.terms).toEqual([
      { term: 'hello', prefix: false },
      { term: 'world', prefix: false },
    ]);
  });

  it('folds diacritics in query terms', () => {
    expect(parseQuery('Perché ').terms).toEqual([{ term: 'perche', prefix: false }]);
  });

  it('expands camelCase and marks the last clause terms as prefix', () => {
    const q = parseQuery('ChatGPT');
    expect(q.terms).toEqual([
      { term: 'chat', prefix: true },
      { term: 'gpt', prefix: true },
      { term: 'chatgpt', prefix: true },
    ]);
  });

  it('returns empty structures for blank input', () => {
    const q = parseQuery('   ');
    expect(q.terms).toEqual([]);
    expect(q.phrases).toEqual([]);
    expect(q.exclusions).toEqual([]);
    expect(q.pathFilters).toEqual([]);
    expect(q.tagFilters).toEqual([]);
  });
});

describe('parseQuery — phrases', () => {
  it('parses a quoted phrase into a folded token sequence', () => {
    const q = parseQuery('"machine learning"');
    expect(q.phrases).toEqual([['machine', 'learning']]);
    expect(q.terms).toEqual([]);
  });

  it('handles an unterminated quote as a phrase-in-progress', () => {
    const q = parseQuery('note "machine learn');
    expect(q.phrases).toEqual([['machine', 'learn']]);
    expect(q.terms).toEqual([{ term: 'note', prefix: false }]);
  });

  it('does not mark prefix when the final clause is a phrase', () => {
    const q = parseQuery('foo "bar baz"');
    expect(q.terms).toEqual([{ term: 'foo', prefix: false }]);
    expect(q.phrases).toEqual([['bar', 'baz']]);
  });
});

describe('parseQuery — operators', () => {
  it('parses exclusions', () => {
    const q = parseQuery('foo -bar');
    expect(q.terms).toEqual([{ term: 'foo', prefix: false }]);
    expect(q.exclusions).toEqual(['bar']);
  });

  it('parses path filters (folded)', () => {
    const q = parseQuery('path:Atlas note');
    expect(q.pathFilters).toEqual(['atlas']);
    expect(q.terms).toEqual([{ term: 'note', prefix: true }]);
  });

  it('parses tag filters and strips a leading #', () => {
    expect(parseQuery('tag:#career ').tagFilters).toEqual(['career']);
    expect(parseQuery('tag:career/job ').tagFilters).toEqual(['career/job']);
  });

  it('ignores empty operator values', () => {
    const q = parseQuery('path: tag: -');
    expect(q.pathFilters).toEqual([]);
    expect(q.tagFilters).toEqual([]);
    expect(q.exclusions).toEqual([]);
  });
});

describe('parseQuery — dedup', () => {
  it('dedupes repeated terms, keeping prefix if any occurrence is a prefix', () => {
    const q = parseQuery('foo foo');
    expect(q.terms).toEqual([{ term: 'foo', prefix: true }]);
  });
});
