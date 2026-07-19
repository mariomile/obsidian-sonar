import type { DocEntry, IndexSnapshot, InvertedIndex, SnapshotTerm } from './inverted-index.ts';

/**
 * Binary cache format for the search index. Bump SCHEMA_VERSION on any layout
 * change; the loader discards a cache whose stored version doesn't match.
 *
 * Schema v3+ aligns every u32 section to four bytes. The decoder can therefore
 * retain zero-copy Uint32Array views over the large postings arena instead of
 * materializing one typed copy plus one JavaScript array per term.
 */
export const SCHEMA_VERSION = 4;

const MAGIC = 0x534e5231; // 'SNR1'
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface DecodedIndex {
  schemaVersion: number;
  tokenizerVersion: number;
  snapshot: IndexSnapshot;
}

export function encodeIndex(
  index: InvertedIndex,
  schemaVersion: number,
  tokenizerVersion: number,
): ArrayBuffer {
  const snap = index.snapshot();
  const metaBytes = encoder.encode(JSON.stringify({ docs: snap.docs }));
  const termsBytes = encoder.encode(snap.terms.map((term) => term.term).join('\n'));
  const termCount = snap.terms.length;

  let postingsWordCount = 0;
  for (const term of snap.terms) postingsWordCount += term.postings.length;

  const metaStart = 12;
  const termCountAt = align4(metaStart + metaBytes.byteLength);
  const termsStart = termCountAt + 8;
  const dfStart = align4(termsStart + termsBytes.byteLength);
  const offStart = dfStart + termCount * 4;
  const lenStart = offStart + termCount * 4;
  const postingsCountAt = lenStart + termCount * 4;
  const postingsStart = postingsCountAt + 4;
  const total = postingsStart + postingsWordCount * 4;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, MAGIC, true);
  view.setUint16(4, schemaVersion, true);
  view.setUint16(6, tokenizerVersion, true);
  view.setUint32(8, metaBytes.byteLength, true);
  bytes.set(metaBytes, metaStart);

  view.setUint32(termCountAt, termCount, true);
  view.setUint32(termCountAt + 4, termsBytes.byteLength, true);
  bytes.set(termsBytes, termsStart);

  const df = new Uint32Array(buffer, dfStart, termCount);
  const off = new Uint32Array(buffer, offStart, termCount);
  const len = new Uint32Array(buffer, lenStart, termCount);
  const postings = new Uint32Array(buffer, postingsStart, postingsWordCount);
  let cursor = 0;
  for (let i = 0; i < termCount; i++) {
    const term = snap.terms[i]!;
    df[i] = term.df;
    off[i] = cursor;
    len[i] = term.postings.length;
    postings.set(term.postings, cursor);
    cursor += term.postings.length;
  }
  view.setUint32(postingsCountAt, postingsWordCount, true);

  return buffer;
}

export function decodeIndex(input: ArrayBuffer | Uint8Array): DecodedIndex | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 12 || view.getUint32(0, true) !== MAGIC) return null;

  const schemaVersion = view.getUint16(4, true);
  const tokenizerVersion = view.getUint16(6, true);
  const metaLen = view.getUint32(8, true);
  let p = 12;
  if (p + metaLen > view.byteLength) return null;
  const meta = JSON.parse(decoder.decode(bytes.subarray(p, p + metaLen))) as {
    docs: DocEntry[];
  };
  p = align4(p + metaLen);

  if (p + 8 > view.byteLength) return null;
  const termCount = view.getUint32(p, true); p += 4;
  const termsLen = view.getUint32(p, true); p += 4;
  if (p + termsLen > view.byteLength) return null;
  const termsBlob = decoder.decode(bytes.subarray(p, p + termsLen));
  const termStrings = termCount > 0 ? termsBlob.split('\n') : [];
  if (termStrings.length !== termCount) return null;
  p = align4(p + termsLen);

  const arraysBytes = termCount * 4 * 3;
  if (p + arraysBytes + 4 > view.byteLength) return null;
  const df = readU32View(bytes, p, termCount); p += termCount * 4;
  const off = readU32View(bytes, p, termCount); p += termCount * 4;
  const len = readU32View(bytes, p, termCount); p += termCount * 4;

  const postingsWordCount = view.getUint32(p, true); p += 4;
  if (p + postingsWordCount * 4 > view.byteLength) return null;
  const postings = readU32View(bytes, p, postingsWordCount);

  const terms: SnapshotTerm[] = new Array(termCount);
  for (let i = 0; i < termCount; i++) {
    const start = off[i]!;
    const length = len[i]!;
    if (start + length > postings.length) return null;
    terms[i] = {
      term: termStrings[i]!,
      df: df[i]!,
      postings: postings.subarray(start, start + length),
    };
  }

  return { schemaVersion, tokenizerVersion, snapshot: { docs: meta.docs, terms } };
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function readU32View(bytes: Uint8Array, offset: number, count: number): Uint32Array {
  const absoluteOffset = bytes.byteOffset + offset;
  if (absoluteOffset % 4 === 0) return new Uint32Array(bytes.buffer, absoluteOffset, count);

  // Defensive fallback for callers passing an unaligned Uint8Array slice.
  const out = new Uint32Array(count);
  const view = new DataView(bytes.buffer, absoluteOffset, count * 4);
  for (let i = 0; i < count; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}
