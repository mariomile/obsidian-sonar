import { describe, expect, it } from 'vitest';
import { InvertedIndex, decodePostings, type DocInput } from './inverted-index.ts';
import { FIELD, FIELD_COUNT } from './fields.ts';

/** Build a DocInput with empty fields, then fill the ones we care about. */
function doc(partial: Partial<DocInput> & { path: string }): DocInput {
  const fields = Array.from({ length: FIELD_COUNT }, () => ({ terms: [] as string[] }));
  return {
    basename: partial.path.replace(/\.md$/, ''),
    mtime: 0,
    size: 0,
    docType: 'md',
    tags: [],
    fields,
    ...partial,
  };
}

function withField(
  d: DocInput,
  field: number,
  terms: string[],
  positions?: number[],
): DocInput {
  d.fields[field] = positions ? { terms, positions } : { terms };
  return d;
}

describe('InvertedIndex — add & lookup', () => {
  it('assigns dense docIds and records the doc entry', () => {
    const idx = new InvertedIndex();
    const id0 = idx.addDocument(withField(doc({ path: 'a.md' }), FIELD.BODY, ['hello', 'world']));
    const id1 = idx.addDocument(withField(doc({ path: 'b.md' }), FIELD.BODY, ['hello']));
    expect(id0).toBe(0);
    expect(id1).toBe(1);
    expect(idx.docCount).toBe(2);
    expect(idx.getIdByPath('a.md')).toBe(0);
    expect(idx.docEntry(0)?.basename).toBe('a');
  });

  it('records df and postings with tf per field and body positions', () => {
    const idx = new InvertedIndex();
    const d = doc({ path: 'a.md' });
    withField(d, FIELD.BASENAME, ['note']);
    withField(d, FIELD.BODY, ['note', 'note', 'text'], [0, 5, 6]);
    idx.addDocument(d);

    const entry = idx.getPostings('note')!;
    expect(entry.df).toBe(1);
    const [row] = decodePostings(entry.postings);
    expect(row!.docId).toBe(0);
    // 'note' appears in BASENAME (tf 1) and BODY (tf 2)
    expect(row!.tf[FIELD.BASENAME]).toBe(1);
    expect(row!.tf[FIELD.BODY]).toBe(2);
    expect(row!.tf[FIELD.H1]).toBe(0);
    // body positions preserved
    expect(row!.bodyPositions).toEqual([0, 5]);
  });

  it('accumulates df across documents', () => {
    const idx = new InvertedIndex();
    idx.addDocument(withField(doc({ path: 'a.md' }), FIELD.BODY, ['cat']));
    idx.addDocument(withField(doc({ path: 'b.md' }), FIELD.BODY, ['cat', 'dog']));
    expect(idx.getPostings('cat')!.df).toBe(2);
    expect(idx.getPostings('dog')!.df).toBe(1);
  });

  it('tracks field length sums for averaging', () => {
    const idx = new InvertedIndex();
    idx.addDocument(withField(doc({ path: 'a.md' }), FIELD.BODY, ['a', 'b', 'c']));
    idx.addDocument(withField(doc({ path: 'b.md' }), FIELD.BODY, ['a']));
    expect(idx.avgFieldLength(FIELD.BODY)).toBeCloseTo((3 + 1) / 2);
  });
});

describe('InvertedIndex — postings round-trip', () => {
  it('decodes exactly what was encoded, including multi-field and no-body cases', () => {
    const idx = new InvertedIndex();
    const d = doc({ path: 'a.md' });
    withField(d, FIELD.BASENAME, ['title']); // no body → no positions
    idx.addDocument(d);
    const [row] = decodePostings(idx.getPostings('title')!.postings);
    expect(row!.fieldMask & (1 << FIELD.BODY)).toBe(0);
    expect(row!.bodyPositions).toEqual([]);
    expect(row!.tf[FIELD.BASENAME]).toBe(1);
  });
});

describe('InvertedIndex — tombstone (lazy deletion)', () => {
  it('marks the doc deleted, updates live count and length sums, leaves df', () => {
    const idx = new InvertedIndex();
    idx.addDocument(withField(doc({ path: 'a.md' }), FIELD.BODY, ['cat', 'x', 'y']));
    idx.addDocument(withField(doc({ path: 'b.md' }), FIELD.BODY, ['cat']));

    idx.tombstone('a.md');
    expect(idx.docCount).toBe(1); // live docs
    expect(idx.isDeleted(0)).toBe(true);
    // df is intentionally NOT decremented (lazy deletion)
    expect(idx.getPostings('cat')!.df).toBe(2);
    // avg body length now reflects only the live doc (1 token)
    expect(idx.avgFieldLength(FIELD.BODY)).toBeCloseTo(1);
  });

  it('re-adding a tombstoned path assigns a fresh docId', () => {
    const idx = new InvertedIndex();
    idx.addDocument(withField(doc({ path: 'a.md' }), FIELD.BODY, ['cat']));
    idx.tombstone('a.md');
    const newId = idx.addDocument(withField(doc({ path: 'a.md' }), FIELD.BODY, ['dog']));
    expect(newId).toBe(1);
    expect(idx.getIdByPath('a.md')).toBe(1);
  });
});

describe('InvertedIndex — prefix search', () => {
  it('returns terms in the prefix range, ranked by df desc, capped', () => {
    const idx = new InvertedIndex();
    // car: df 3, card: df 2, cat: df 1, dog: df 1
    idx.addDocument(withField(doc({ path: '1.md' }), FIELD.BODY, ['car', 'card', 'cat', 'dog']));
    idx.addDocument(withField(doc({ path: '2.md' }), FIELD.BODY, ['car', 'card']));
    idx.addDocument(withField(doc({ path: '3.md' }), FIELD.BODY, ['car']));

    expect(idx.prefixTerms('ca')).toEqual(['car', 'card', 'cat']);
    expect(idx.prefixTerms('car')).toEqual(['car', 'card']);
    expect(idx.prefixTerms('ca', 2)).toEqual(['car', 'card']);
    expect(idx.prefixTerms('z')).toEqual([]);
  });

  it('keeps sortedTerms consistent after incremental adds', () => {
    const idx = new InvertedIndex();
    idx.addDocument(withField(doc({ path: '1.md' }), FIELD.BODY, ['cat']));
    idx.addDocument(withField(doc({ path: '2.md' }), FIELD.BODY, ['car']));
    expect(idx.prefixTerms('ca')).toEqual(['car', 'cat']); // df tie → alphabetical stable
  });
});

describe('InvertedIndex — compaction', () => {
  it('drops tombstoned docs, redensifies ids, recomputes df, clears tombstones', () => {
    const idx = new InvertedIndex();
    idx.addDocument(withField(doc({ path: 'a.md' }), FIELD.BODY, ['cat', 'apple']));
    idx.addDocument(withField(doc({ path: 'b.md' }), FIELD.BODY, ['cat']));
    idx.addDocument(withField(doc({ path: 'c.md' }), FIELD.BODY, ['cat', 'dog']));
    idx.tombstone('a.md'); // removes 'apple' entirely, drops one 'cat'

    idx.compact();

    expect(idx.docCount).toBe(2);
    expect(idx.rawDocCount).toBe(2); // no tombstones left
    // ids redensified: b.md → 0, c.md → 1
    expect(idx.getIdByPath('b.md')).toBe(0);
    expect(idx.getIdByPath('c.md')).toBe(1);
    // df recomputed for live docs only
    expect(idx.getPostings('cat')!.df).toBe(2);
    expect(idx.getPostings('apple')).toBeUndefined(); // term gone
    expect(idx.getPostings('dog')!.df).toBe(1);
    // postings now reference the new dense ids
    const rows = decodePostings(idx.getPostings('cat')!.postings).map((r) => r.docId);
    expect(rows).toEqual([0, 1]);
  });
});
