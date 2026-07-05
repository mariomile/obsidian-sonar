import { BODY_FIELD, FIELD_COUNT, type DocType } from './fields.ts';

export interface FieldInput {
  /** Folded terms in document order. */
  terms: string[];
  /** Parallel positions; only meaningful (and stored) for the BODY field. */
  positions?: number[];
}

export interface DocInput {
  path: string;
  basename: string;
  mtime: number;
  size: number;
  docType: DocType;
  /** Folded tag strings, for the `tag:` filter and result rendering. */
  tags: string[];
  /** One entry per field (length FIELD_COUNT), in field-id order. */
  fields: FieldInput[];
}

export interface DocEntry {
  path: string;
  basename: string;
  mtime: number;
  size: number;
  docType: DocType;
  tags: string[];
  /** Token count per field (length FIELD_COUNT), for BM25F normalization. */
  fieldLengths: number[];
  deleted: boolean;
}

export interface TermEntry {
  df: number;
  /**
   * Flat posting groups. Each group:
   *   docId, fieldMask, tf[popcount(fieldMask)] (ascending field), then—
   *   if the BODY bit is set—posCount followed by posCount body positions.
   */
  postings: number[];
}

export interface DecodedPosting {
  docId: number;
  fieldMask: number;
  /** tf per field, length FIELD_COUNT (0 where the field bit is unset). */
  tf: number[];
  /** Body token positions (empty when the BODY bit is unset). */
  bodyPositions: number[];
}

const BODY_BIT = 1 << BODY_FIELD;

function popcount(mask: number): number {
  let n = 0;
  let m = mask;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

/** Decode a term's flat postings into structured rows (used by tests + scoring). */
export function decodePostings(postings: number[]): DecodedPosting[] {
  const rows: DecodedPosting[] = [];
  let i = 0;
  const n = postings.length;
  while (i < n) {
    const docId = postings[i++]!;
    const fieldMask = postings[i++]!;
    const tf = new Array<number>(FIELD_COUNT).fill(0);
    for (let f = 0; f < FIELD_COUNT; f++) {
      if (fieldMask & (1 << f)) tf[f] = postings[i++]!;
    }
    let bodyPositions: number[] = [];
    if (fieldMask & BODY_BIT) {
      const posCount = postings[i++]!;
      bodyPositions = postings.slice(i, i + posCount);
      i += posCount;
    }
    rows.push({ docId, fieldMask, tf, bodyPositions });
  }
  return rows;
}

/** Aggregate a document's field inputs into per-term (mask, tf, positions). */
interface TermAgg {
  mask: number;
  tf: number[];
  positions: number[];
}

/** Lower bound: index of the first term in `sorted` that is >= `key`. */
function lowerBound(sorted: string[], key: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class InvertedIndex {
  private docs: DocEntry[] = [];
  private pathToId = new Map<string, number>();
  private terms = new Map<string, TermEntry>();
  /** Sorted term dictionary, kept in sync for prefix range queries. */
  private sortedTerms: string[] = [];
  private fieldLengthSums = new Array<number>(FIELD_COUNT).fill(0);
  private liveDocCount = 0;
  private deletedSet = new Set<number>();

  /** Number of live (non-tombstoned) documents. */
  get docCount(): number {
    return this.liveDocCount;
  }

  /** Total document slots including tombstones. */
  get rawDocCount(): number {
    return this.docs.length;
  }

  /** Count of tombstoned documents awaiting compaction. */
  get tombstoneCount(): number {
    return this.deletedSet.size;
  }

  docEntry(id: number): DocEntry | undefined {
    return this.docs[id];
  }

  isDeleted(id: number): boolean {
    return this.docs[id]?.deleted ?? true;
  }

  getIdByPath(path: string): number | undefined {
    return this.pathToId.get(path);
  }

  /** Paths of all live (non-tombstoned) documents. */
  livePaths(): string[] {
    return [...this.pathToId.keys()];
  }

  /** Live document entries (with their docId), for browse/recency views. */
  liveEntries(): Array<{ docId: number; entry: DocEntry }> {
    const out: Array<{ docId: number; entry: DocEntry }> = [];
    for (const docId of this.pathToId.values()) {
      const entry = this.docs[docId];
      if (entry && !entry.deleted) out.push({ docId, entry });
    }
    return out;
  }

  getPostings(term: string): TermEntry | undefined {
    return this.terms.get(term);
  }

  /** The sorted term dictionary (read-only) — used by the fuzzy fallback scan. */
  get allTerms(): readonly string[] {
    return this.sortedTerms;
  }

  avgFieldLength(field: number): number {
    if (this.liveDocCount === 0) return 0;
    return this.fieldLengthSums[field]! / this.liveDocCount;
  }

  addDocument(input: DocInput): number {
    const docId = this.docs.length;
    const fieldLengths = new Array<number>(FIELD_COUNT).fill(0);

    // Aggregate term → (fieldMask, tf per field, body positions) for this doc.
    const agg = new Map<string, TermAgg>();
    for (let f = 0; f < FIELD_COUNT; f++) {
      const field = input.fields[f];
      if (!field) continue;
      fieldLengths[f] = field.terms.length;
      const isBody = f === BODY_FIELD;
      for (let t = 0; t < field.terms.length; t++) {
        const term = field.terms[t]!;
        let a = agg.get(term);
        if (!a) {
          a = { mask: 0, tf: new Array<number>(FIELD_COUNT).fill(0), positions: [] };
          agg.set(term, a);
        }
        a.mask |= 1 << f;
        a.tf[f]!++;
        if (isBody && field.positions) a.positions.push(field.positions[t]!);
      }
    }

    // Append postings for each term and update the dictionary.
    for (const [term, a] of agg) {
      let entry = this.terms.get(term);
      if (!entry) {
        entry = { df: 0, postings: [] };
        this.terms.set(term, entry);
        this.insertSortedTerm(term);
      }
      entry.df++;
      const p = entry.postings;
      p.push(docId, a.mask);
      for (let f = 0; f < FIELD_COUNT; f++) {
        if (a.mask & (1 << f)) p.push(a.tf[f]!);
      }
      if (a.mask & BODY_BIT) {
        // Push one at a time — spreading a large positions array into push()
        // can blow the call-stack arg limit on big documents.
        p.push(a.positions.length);
        for (let k = 0; k < a.positions.length; k++) p.push(a.positions[k]!);
      }
    }

    this.docs.push({
      path: input.path,
      basename: input.basename,
      mtime: input.mtime,
      size: input.size,
      docType: input.docType,
      tags: input.tags,
      fieldLengths,
      deleted: false,
    });
    this.pathToId.set(input.path, docId);
    for (let f = 0; f < FIELD_COUNT; f++) this.fieldLengthSums[f]! += fieldLengths[f]!;
    this.liveDocCount++;
    return docId;
  }

  /** Mark a document deleted (lazy): postings and df are left for compaction. */
  tombstone(path: string): void {
    const id = this.pathToId.get(path);
    if (id === undefined) return;
    const entry = this.docs[id];
    if (!entry || entry.deleted) return;
    entry.deleted = true;
    this.deletedSet.add(id);
    this.pathToId.delete(path);
    for (let f = 0; f < FIELD_COUNT; f++) this.fieldLengthSums[f]! -= entry.fieldLengths[f]!;
    this.liveDocCount--;
  }

  /**
   * Terms sharing `prefix`, ranked by df desc (alphabetical on ties), capped.
   * Powers as-you-type prefix matching on the last query token.
   */
  prefixTerms(prefix: string, cap = 200): string[] {
    if (!prefix) return [];
    const start = lowerBound(this.sortedTerms, prefix);
    const hits: string[] = [];
    for (let i = start; i < this.sortedTerms.length; i++) {
      const term = this.sortedTerms[i]!;
      if (!term.startsWith(prefix)) break;
      hits.push(term);
    }
    hits.sort((a, b) => (this.terms.get(b)!.df - this.terms.get(a)!.df) || (a < b ? -1 : 1));
    return hits.slice(0, cap);
  }

  /**
   * Rebuild the index over live docs only: redensify docIds, drop tombstoned
   * postings, recompute df, and forget emptied terms. Pure in-memory — no file
   * re-read needed because postings already carry everything.
   */
  compact(): void {
    if (this.deletedSet.size === 0) return;

    const oldToNew = new Map<number, number>();
    const newDocs: DocEntry[] = [];
    const newPathToId = new Map<string, number>();
    for (let id = 0; id < this.docs.length; id++) {
      const d = this.docs[id]!;
      if (d.deleted) continue;
      const newId = newDocs.length;
      oldToNew.set(id, newId);
      newDocs.push(d);
      newPathToId.set(d.path, newId);
    }

    const newTerms = new Map<string, TermEntry>();
    for (const [term, entry] of this.terms) {
      const rebuilt: number[] = [];
      let df = 0;
      const src = entry.postings;
      let i = 0;
      const n = src.length;
      while (i < n) {
        const groupStart = i;
        const docId = src[i++]!;
        const fieldMask = src[i++]!;
        i += popcount(fieldMask); // tf values
        if (fieldMask & BODY_BIT) {
          const posCount = src[i++]!;
          i += posCount;
        }
        const newId = oldToNew.get(docId);
        if (newId === undefined) continue; // tombstoned
        // Copy the group verbatim, only rewriting the docId.
        rebuilt.push(newId);
        for (let k = groupStart + 1; k < i; k++) rebuilt.push(src[k]!);
        df++;
      }
      if (df > 0) newTerms.set(term, { df, postings: rebuilt });
    }

    this.docs = newDocs;
    this.pathToId = newPathToId;
    this.terms = newTerms;
    this.sortedTerms = [...newTerms.keys()].sort();
    this.fieldLengthSums = new Array<number>(FIELD_COUNT).fill(0);
    for (const d of newDocs) {
      for (let f = 0; f < FIELD_COUNT; f++) this.fieldLengthSums[f]! += d.fieldLengths[f]!;
    }
    this.liveDocCount = newDocs.length;
    this.deletedSet.clear();
  }

  private insertSortedTerm(term: string): void {
    const at = lowerBound(this.sortedTerms, term);
    this.sortedTerms.splice(at, 0, term);
  }

  /**
   * Lossless snapshot of the current state (including tombstones) for
   * serialization. Docs keep their current ids; the loader rebuilds all
   * derived structures.
   */
  snapshot(): IndexSnapshot {
    const terms: SnapshotTerm[] = [];
    for (const [term, entry] of this.terms) {
      terms.push({ term, df: entry.df, postings: entry.postings });
    }
    return { docs: this.docs, terms };
  }

  /** Replace all state from a snapshot (e.g. after loading the disk cache). */
  loadSnapshot(snap: IndexSnapshot): void {
    this.docs = snap.docs;
    this.pathToId = new Map();
    this.terms = new Map();
    this.fieldLengthSums = new Array<number>(FIELD_COUNT).fill(0);
    this.liveDocCount = 0;
    this.deletedSet = new Set();

    for (let id = 0; id < this.docs.length; id++) {
      const d = this.docs[id]!;
      if (d.deleted) {
        this.deletedSet.add(id);
        continue;
      }
      this.pathToId.set(d.path, id);
      for (let f = 0; f < FIELD_COUNT; f++) this.fieldLengthSums[f]! += d.fieldLengths[f]!;
      this.liveDocCount++;
    }
    for (const t of snap.terms) this.terms.set(t.term, { df: t.df, postings: t.postings });
    this.sortedTerms = [...this.terms.keys()].sort();
  }
}

export interface SnapshotTerm {
  term: string;
  df: number;
  postings: number[];
}

export interface IndexSnapshot {
  docs: DocEntry[];
  terms: SnapshotTerm[];
}
