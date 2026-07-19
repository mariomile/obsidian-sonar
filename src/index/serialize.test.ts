import { describe, expect, it } from 'vitest';
import { InvertedIndex, type DocInput } from './inverted-index.ts';
import { extractFields } from './field-extract.ts';
import { encodeIndex, decodeIndex, SCHEMA_VERSION } from './serialize.ts';
import { search } from './search-core.ts';
import { TOKENIZER_VERSION } from './tokenizer.ts';

const NOW = 1_000 * 86_400_000;

function docFrom(path: string, content: string, mtime = NOW): DocInput {
  const basename = path.replace(/\.md$/, '');
  const { fields, tags } = extractFields({ basename, content, meta: {} });
  return { path, basename, mtime, size: content.length, docType: 'md', tags, fields };
}

function buildIndex(): InvertedIndex {
  const index = new InvertedIndex();
  index.addDocument(docFrom('cat.md', 'the cat sat on the mat perché'));
  index.addDocument(docFrom('dog.md', 'a dog and a cat play together'));
  index.addDocument(docFrom('bird.md', 'birds fly over the cat and dog'));
  return index;
}

describe('serialize — round trip', () => {
  it('reproduces search results after encode → decode → load', () => {
    const index = buildIndex();
    const before = search(index, 'cat', { now: NOW }).map((r) => [r.path, r.score]);

    const buffer = encodeIndex(index, SCHEMA_VERSION, TOKENIZER_VERSION);
    const decoded = decodeIndex(buffer)!;
    expect(decoded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(decoded.tokenizerVersion).toBe(TOKENIZER_VERSION);

    const restored = new InvertedIndex();
    restored.loadSnapshot(decoded.snapshot);
    const after = search(restored, 'cat', { now: NOW }).map((r) => [r.path, r.score]);
    expect(after).toEqual(before);
  });

  it('preserves doc entries and postings exactly', () => {
    const index = buildIndex();
    const buffer = encodeIndex(index, SCHEMA_VERSION, TOKENIZER_VERSION);
    const restored = new InvertedIndex();
    restored.loadSnapshot(decodeIndex(buffer)!.snapshot);

    expect(restored.docCount).toBe(index.docCount);
    expect(restored.docEntry(0)).toEqual(index.docEntry(0));
    expect(Array.from(restored.getPostings('cat')!.postings)).toEqual(index.getPostings('cat')!.postings);
  });

  it('keeps decoded postings as zero-copy typed views until they are mutated', () => {
    const index = buildIndex();
    const decoded = decodeIndex(encodeIndex(index, SCHEMA_VERSION, TOKENIZER_VERSION))!;
    expect(decoded.snapshot.terms[0]!.postings).toBeInstanceOf(Uint32Array);

    const restored = new InvertedIndex();
    restored.loadSnapshot(decoded.snapshot);
    restored.addDocument(docFrom('more-cats.md', 'cat'));
    expect(restored.getPostings('cat')!.df).toBe(4);
  });

  it('preserves tombstones across the round trip', () => {
    const index = buildIndex();
    index.tombstone('dog.md');
    const buffer = encodeIndex(index, SCHEMA_VERSION, TOKENIZER_VERSION);
    const restored = new InvertedIndex();
    restored.loadSnapshot(decodeIndex(buffer)!.snapshot);

    expect(restored.docCount).toBe(2);
    expect(restored.getIdByPath('dog.md')).toBeUndefined();
    expect(search(restored, 'cat', { now: NOW }).map((r) => r.path)).not.toContain('dog.md');
  });
});

describe('serialize — invalidation', () => {
  it('returns null on a bad magic header', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    expect(decodeIndex(junk)).toBeNull();
  });

  it('surfaces stored versions so the caller can invalidate on mismatch', () => {
    const index = buildIndex();
    const buffer = encodeIndex(index, 999, 7);
    const decoded = decodeIndex(buffer)!;
    expect(decoded.schemaVersion).toBe(999);
    expect(decoded.tokenizerVersion).toBe(7);
  });
});
