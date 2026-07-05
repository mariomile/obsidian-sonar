import { describe, expect, it } from 'vitest';
import { InvertedIndex } from './inverted-index.ts';
import { extractFields, type NoteMeta } from './field-extract.ts';
import { search, excerptWeights } from './search-core.ts';

const NOW = 1_000 * 86_400_000;

interface NoteSpec {
  path: string;
  content?: string;
  meta?: NoteMeta;
  mtime?: number;
}

function buildIndex(notes: NoteSpec[]): InvertedIndex {
  const index = new InvertedIndex();
  for (const note of notes) {
    const basename = note.path.replace(/\.md$/, '').split('/').pop()!;
    const { fields, tags } = extractFields({
      basename,
      content: note.content ?? '',
      meta: note.meta ?? {},
    });
    index.addDocument({
      path: note.path,
      basename,
      mtime: note.mtime ?? NOW,
      size: (note.content ?? '').length,
      docType: 'md',
      tags,
      fields,
    });
  }
  return index;
}

function paths(index: InvertedIndex, query: string): string[] {
  return search(index, query, { now: NOW }).map((r) => r.path);
}

describe('search — relevance tiers', () => {
  it('orders exact > prefix > fuzzy and pulls in fuzzy only when results are sparse', () => {
    const index = buildIndex([
      { path: 'exact.md', content: 'cat' },
      { path: 'prefix.md', content: 'catalog of items' },
      { path: 'fuzzy.md', content: 'a cot in the room' },
    ]);
    // "cat" typed without trailing space → last token is a prefix.
    expect(paths(index, 'cat')).toEqual(['exact.md', 'prefix.md', 'fuzzy.md']);
  });

  it('does not invoke fuzzy when there are already enough strong results', () => {
    const notes: NoteSpec[] = [];
    for (let i = 0; i < 6; i++) notes.push({ path: `n${i}.md`, content: 'cat cat' });
    notes.push({ path: 'typo.md', content: 'cot' });
    const index = buildIndex(notes);
    expect(paths(index, 'cat ')).not.toContain('typo.md');
  });
});

describe('search — fields & folding', () => {
  it('ranks a basename match highly and folds diacritics', () => {
    const index = buildIndex([
      { path: 'GTM Strategy.md', content: 'go to market plan' },
      { path: 'other.md', content: 'unrelated gtm mention in body only' },
    ]);
    expect(paths(index, 'gtm')[0]).toBe('GTM Strategy.md');
  });

  it('matches accented content from an unaccented query', () => {
    const index = buildIndex([{ path: 'note.md', content: 'la ragione del perché conta' }]);
    expect(paths(index, 'perche ')).toEqual(['note.md']);
  });
});

describe('search — operators', () => {
  it('applies tag filters', () => {
    const index = buildIndex([
      { path: 'a.md', content: 'report', meta: { frontmatter: { tags: ['career/job'] } } },
      { path: 'b.md', content: 'report' },
    ]);
    expect(paths(index, 'report tag:career')).toEqual(['a.md']);
  });

  it('applies path filters', () => {
    const index = buildIndex([
      { path: 'Atlas/a.md', content: 'report' },
      { path: 'Journal/b.md', content: 'report' },
    ]);
    expect(paths(index, 'report path:atlas')).toEqual(['Atlas/a.md']);
  });

  it('applies exclusions', () => {
    const index = buildIndex([
      { path: 'a.md', content: 'report draft' },
      { path: 'b.md', content: 'report final' },
    ]);
    expect(paths(index, 'report -draft')).toEqual(['b.md']);
  });

  it('boosts adjacent phrases', () => {
    const index = buildIndex([
      { path: 'adj.md', content: 'the machine learning course' },
      { path: 'scattered.md', content: 'machine oil and heavy learning load' },
    ]);
    expect(paths(index, '"machine learning"')[0]).toBe('adj.md');
  });
});

describe('search — title only & chip filters', () => {
  it('titleOnly ignores body matches, keeps title matches', () => {
    const index = buildIndex([
      { path: 'Report Q1.md', content: 'unrelated prose' },
      { path: 'other.md', content: 'this mentions report several times: report report' },
    ]);
    expect(paths(index, 'report ')).toContain('other.md'); // body match counts normally
    const titleOnly = search(index, 'report ', { now: NOW, titleOnly: true }).map((r) => r.path);
    expect(titleOnly).toEqual(['Report Q1.md']); // body-only match excluded
  });

  it('applies a minMtime date filter', () => {
    const index = buildIndex([
      { path: 'old.md', content: 'report', mtime: NOW - 100 * 86_400_000 },
      { path: 'new.md', content: 'report', mtime: NOW - 1 * 86_400_000 },
    ]);
    const r = search(index, 'report ', { now: NOW, minMtime: NOW - 7 * 86_400_000 });
    expect(r.map((x) => x.path)).toEqual(['new.md']);
  });

  it('applies chip path/tag filters passed via options', () => {
    const index = buildIndex([
      { path: 'Atlas/a.md', content: 'report', meta: { frontmatter: { tags: ['work'] } } },
      { path: 'Atlas/b.md', content: 'report' },
      { path: 'Journal/c.md', content: 'report', meta: { frontmatter: { tags: ['work'] } } },
    ]);
    const r = search(index, 'report ', { now: NOW, pathFilters: ['atlas'], tagFilters: ['work'] });
    expect(r.map((x) => x.path)).toEqual(['Atlas/a.md']);
  });
});

describe('search — empty & filter-only', () => {
  it('returns nothing for a blank query', () => {
    const index = buildIndex([{ path: 'a.md', content: 'x' }]);
    expect(paths(index, '   ')).toEqual([]);
  });

  it('returns nothing for a filter-only query with no positive terms', () => {
    const index = buildIndex([{ path: 'a.md', content: 'x', meta: { frontmatter: { tags: ['t'] } } }]);
    expect(paths(index, 'tag:t')).toEqual([]);
  });
});

describe('excerptWeights', () => {
  it('assigns higher weight to rarer terms', () => {
    const index = buildIndex([
      { path: 'a.md', content: 'common common rare' },
      { path: 'b.md', content: 'common word' },
      { path: 'c.md', content: 'common thing' },
    ]);
    const w = excerptWeights(index, ['common', 'rare']);
    expect(w.get('rare')!).toBeGreaterThan(w.get('common')!);
  });
});
