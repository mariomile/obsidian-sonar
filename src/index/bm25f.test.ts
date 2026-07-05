import { describe, expect, it } from 'vitest';
import { InvertedIndex, type DocInput, type FieldInput } from './inverted-index.ts';
import { FIELD, FIELD_COUNT } from './fields.ts';
import { rank, type TermGroup } from './bm25f.ts';
import { tokenize } from './tokenizer.ts';

const DAY = 86_400_000;
const NOW = 1_000 * DAY;

function makeDoc(path: string, fieldTerms: Partial<Record<number, string>>, mtime = NOW): DocInput {
  const fields: FieldInput[] = Array.from({ length: FIELD_COUNT }, () => ({ terms: [] }));
  for (const [f, text] of Object.entries(fieldTerms)) {
    const toks = tokenize(text!);
    const field = Number(f);
    fields[field] =
      field === FIELD.BODY
        ? { terms: toks.map((t) => t.text), positions: toks.map((t) => t.pos) }
        : { terms: toks.map((t) => t.text) };
  }
  return { path, basename: path.replace(/\.md$/, ''), mtime, size: 0, docType: 'md', tags: [], fields };
}

function exact(...terms: string[]): TermGroup[] {
  return terms.map((t) => ({ variants: [t], weight: 1 }));
}

function order(index: InvertedIndex, groups: TermGroup[], phrases: string[][] = []): string[] {
  return rank({ index, groups, phrases, now: NOW, limit: 20 }).map(
    (r) => index.docEntry(r.docId)!.path,
  );
}

describe('rank — field weighting', () => {
  it('ranks a basename hit above a body hit for the same term', () => {
    const index = new InvertedIndex();
    index.addDocument(makeDoc('body.md', { [FIELD.BODY]: 'mango is tasty here' }));
    index.addDocument(makeDoc('title.md', { [FIELD.BASENAME]: 'mango' }));
    expect(order(index, exact('mango'))).toEqual(['title.md', 'body.md']);
  });
});

describe('rank — coverage', () => {
  it('ranks a doc matching two query terms above one matching a single term', () => {
    const index = new InvertedIndex();
    index.addDocument(makeDoc('both.md', { [FIELD.BODY]: 'alpha beta gamma delta' }));
    index.addDocument(makeDoc('one.md', { [FIELD.BODY]: 'alpha alpha alpha alpha' }));
    expect(order(index, exact('alpha', 'beta'))).toEqual(['both.md', 'one.md']);
  });
});

describe('rank — exact beats prefix beats fuzzy', () => {
  it('orders exact > prefix > fuzzy for comparable matches', () => {
    const index = new InvertedIndex();
    index.addDocument(makeDoc('exact.md', { [FIELD.BODY]: 'cat' }));
    index.addDocument(makeDoc('prefix.md', { [FIELD.BODY]: 'catalog' }));
    index.addDocument(makeDoc('fuzzy.md', { [FIELD.BODY]: 'bat' }));
    const groups: TermGroup[] = [
      { variants: ['cat'], weight: 1 },
      { variants: ['catalog'], weight: 0.35 },
      { variants: ['bat'], weight: 0.2 },
    ];
    // Each doc only contains one of the variants, so per-doc a single group fires.
    expect(order(index, groups)).toEqual(['exact.md', 'prefix.md', 'fuzzy.md']);
  });
});

describe('rank — recency', () => {
  it('breaks ties toward the more recently modified doc', () => {
    const index = new InvertedIndex();
    index.addDocument(makeDoc('old.md', { [FIELD.BODY]: 'report' }, NOW - 400 * DAY));
    index.addDocument(makeDoc('new.md', { [FIELD.BODY]: 'report' }, NOW - 1 * DAY));
    expect(order(index, exact('report'))).toEqual(['new.md', 'old.md']);
  });
});

describe('rank — phrase adjacency', () => {
  it('ranks a doc with the adjacent phrase above one with the terms scattered', () => {
    const index = new InvertedIndex();
    index.addDocument(makeDoc('adjacent.md', { [FIELD.BODY]: 'the machine learning course' }));
    index.addDocument(
      makeDoc('scattered.md', { [FIELD.BODY]: 'machine tools and deep learning notes' }),
    );
    const groups = exact('machine', 'learning');
    expect(order(index, groups, [['machine', 'learning']])).toEqual([
      'adjacent.md',
      'scattered.md',
    ]);
  });
});

describe('rank — filtering', () => {
  it('excludes tombstoned docs', () => {
    const index = new InvertedIndex();
    index.addDocument(makeDoc('a.md', { [FIELD.BODY]: 'target' }));
    index.addDocument(makeDoc('b.md', { [FIELD.BODY]: 'target' }));
    index.tombstone('a.md');
    expect(order(index, exact('target'))).toEqual(['b.md']);
  });

  it('honors the allow predicate', () => {
    const index = new InvertedIndex();
    index.addDocument(makeDoc('keep.md', { [FIELD.BODY]: 'target' }));
    index.addDocument(makeDoc('drop.md', { [FIELD.BODY]: 'target' }));
    const results = rank({
      index,
      groups: exact('target'),
      phrases: [],
      now: NOW,
      limit: 20,
      allow: (id) => index.docEntry(id)!.path !== 'drop.md',
    });
    expect(results.map((r) => index.docEntry(r.docId)!.path)).toEqual(['keep.md']);
  });
});

describe('rank — matched terms', () => {
  it('reports the folded terms that matched each doc (for highlighting)', () => {
    const index = new InvertedIndex();
    index.addDocument(makeDoc('a.md', { [FIELD.BODY]: 'alpha beta' }));
    const [top] = rank({
      index,
      groups: [{ variants: ['alph', 'alpha'], weight: 0.35 }, ...exact('beta')],
      phrases: [],
      now: NOW,
      limit: 20,
    });
    expect(new Set(top!.matched)).toEqual(new Set(['alpha', 'beta']));
  });
});
