import type { DocEntry, IndexSnapshot, InvertedIndex, SnapshotTerm } from './inverted-index.ts';

/**
 * Binary cache format for the search index. Bump SCHEMA_VERSION on any layout
 * change; the loader discards a cache whose stored version doesn't match.
 *
 * Layout (little-endian):
 *   'SNR1'                         magic (4 bytes)
 *   u16 schemaVersion
 *   u16 tokenizerVersion
 *   u32 metaJsonByteLen · metaJson (UTF-8) — the doc store: { docs: DocEntry[] }
 *   u32 termCount
 *   u32 termsBlobByteLen · termsBlob (UTF-8, terms joined by '\n')
 *   u32 df[termCount]              document frequency per term
 *   u32 off[termCount]             postings start word offset per term
 *   u32 len[termCount]             postings word length per term
 *   u32 postingsWordCount · u32 postings[postingsWordCount]
 *
 * The doc store rides as small JSON (fast to parse); the large term/postings
 * arrays are raw u32 so there's no million-element JSON.parse on warm boot.
 */
export const SCHEMA_VERSION = 2;

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
  const termsBytes = encoder.encode(snap.terms.map((t) => t.term).join('\n'));
  const termCount = snap.terms.length;

  const df = new Uint32Array(termCount);
  const off = new Uint32Array(termCount);
  const len = new Uint32Array(termCount);
  let postingsWordCount = 0;
  for (let i = 0; i < termCount; i++) {
    const t = snap.terms[i]!;
    df[i] = t.df;
    off[i] = postingsWordCount;
    len[i] = t.postings.length;
    postingsWordCount += t.postings.length;
  }
  const postings = new Uint32Array(postingsWordCount);
  {
    let cursor = 0;
    for (const t of snap.terms) {
      postings.set(t.postings, cursor);
      cursor += t.postings.length;
    }
  }

  const total =
    4 + 2 + 2 + // magic + versions
    4 + metaBytes.byteLength +
    4 + // termCount
    4 + termsBytes.byteLength +
    termCount * 4 * 3 + // df/off/len
    4 + postingsWordCount * 4;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let p = 0;

  view.setUint32(p, MAGIC, true); p += 4;
  view.setUint16(p, schemaVersion, true); p += 2;
  view.setUint16(p, tokenizerVersion, true); p += 2;

  view.setUint32(p, metaBytes.byteLength, true); p += 4;
  bytes.set(metaBytes, p); p += metaBytes.byteLength;

  view.setUint32(p, termCount, true); p += 4;
  view.setUint32(p, termsBytes.byteLength, true); p += 4;
  bytes.set(termsBytes, p); p += termsBytes.byteLength;

  p = writeU32Array(view, p, df);
  p = writeU32Array(view, p, off);
  p = writeU32Array(view, p, len);

  view.setUint32(p, postingsWordCount, true); p += 4;
  p = writeU32Array(view, p, postings);

  return buffer;
}

export function decodeIndex(input: ArrayBuffer | Uint8Array): DecodedIndex | null {
  const buffer = input instanceof Uint8Array ? input.buffer : input;
  const view = new DataView(buffer);
  if (view.byteLength < 8 || view.getUint32(0, true) !== MAGIC) return null;
  let p = 4;
  const schemaVersion = view.getUint16(p, true); p += 2;
  const tokenizerVersion = view.getUint16(p, true); p += 2;

  const metaLen = view.getUint32(p, true); p += 4;
  const meta = JSON.parse(decoder.decode(new Uint8Array(buffer, p, metaLen))) as {
    docs: DocEntry[];
  };
  p += metaLen;

  const termCount = view.getUint32(p, true); p += 4;
  const termsLen = view.getUint32(p, true); p += 4;
  const termsBlob = decoder.decode(new Uint8Array(buffer, p, termsLen));
  p += termsLen;
  const termStrings = termCount > 0 ? termsBlob.split('\n') : [];

  const df = readU32Array(view, p, termCount); p += termCount * 4;
  const off = readU32Array(view, p, termCount); p += termCount * 4;
  const len = readU32Array(view, p, termCount); p += termCount * 4;

  const postingsWordCount = view.getUint32(p, true); p += 4;
  const postings = readU32Array(view, p, postingsWordCount);

  const terms: SnapshotTerm[] = new Array(termCount);
  for (let i = 0; i < termCount; i++) {
    const start = off[i]!;
    const length = len[i]!;
    terms[i] = {
      term: termStrings[i]!,
      df: df[i]!,
      postings: Array.from(postings.subarray(start, start + length)),
    };
  }

  return { schemaVersion, tokenizerVersion, snapshot: { docs: meta.docs, terms } };
}

function writeU32Array(view: DataView, p: number, arr: Uint32Array): number {
  for (let i = 0; i < arr.length; i++) {
    view.setUint32(p, arr[i]!, true);
    p += 4;
  }
  return p;
}

function readU32Array(view: DataView, p: number, count: number): Uint32Array {
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getUint32(p + i * 4, true);
  return out;
}
