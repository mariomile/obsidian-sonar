import { BODY_FIELD, FIELD_COUNT } from './fields.ts';
import type { InvertedIndex } from './inverted-index.ts';

/**
 * All ranking constants in one place. Relative order is locked by tests; tune
 * these against real queries with the modal's debug score mode. Field arrays
 * are indexed by FieldId (basename … body).
 */
export const RANK = {
  k1: 1.2,
  // Field weights: basename ≫ aliases > h1 > tags > h2h3 > frontmatter > body.
  // Title fields are weighted high enough that a single title hit dominates even
  // heavy body repetition — under BM25 saturation, tf=10 in body reaches ~0.89
  // of its idf, so a basename hit must clear that bar (12/(k1+12) ≈ 0.91).
  fieldWeight: [12.0, 9.0, 6.0, 4.0, 5.0, 2.5, 1.0],
  // Length normalization b per field: 0 for short fields, 0.75 for body.
  fieldB: [0.0, 0.0, 0.3, 0.3, 0.0, 0.3, 0.75],
  prefixWeight: 0.35,
  fuzzyWeight: 0.2,
  coverage: 0.15,
  proximityMax: 0.1,
  proximityWindow: 8,
  phraseBonus: 0.5,
  recencyR: 0.15,
  recencyHalfLifeDays: 90,
  /** How many top candidates get the proximity/phrase rescoring pass. */
  rescoreTop: 100,
} as const;

const DAY_MS = 86_400_000;
const BODY_BIT = 1 << BODY_FIELD;

export interface TermGroup {
  /** Folded terms to look up. One for exact; many for prefix/fuzzy expansions. */
  variants: string[];
  /** Group weight multiplier: 1 exact, RANK.prefixWeight, RANK.fuzzyWeight. */
  weight: number;
}

export interface RankInput {
  index: InvertedIndex;
  groups: TermGroup[];
  /** Folded phrase token sequences for the adjacency bonus. */
  phrases: string[][];
  /** Epoch ms used for the recency decay. */
  now: number;
  limit: number;
  /** Optional filter predicate (path/tag filters, exclusions). */
  allow?: (docId: number) => boolean;
  /** When set, only these fields contribute (e.g. title-only search). */
  restrictFields?: Set<number>;
}

export interface ScoredDoc {
  docId: number;
  score: number;
  /** Folded terms that matched this doc (winning variants), for highlighting. */
  matched: string[];
}

interface DocAcc {
  base: number;
  groupsMatched: number;
  matched: string[];
  /** Winning-variant body positions per matched term (for proximity/phrase). */
  positions: Map<string, number[]>;
}

function idf(n: number, df: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

/** Smallest span (in token positions) covering one occurrence of each term. */
function minWindow(posLists: number[][]): number | null {
  const k = posLists.length;
  if (k < 2) return null;
  const items: Array<[number, number]> = [];
  posLists.forEach((arr, tid) => arr.forEach((p) => items.push([p, tid])));
  if (items.length < k) return null;
  items.sort((a, b) => a[0] - b[0]);
  const have = new Map<number, number>();
  let formed = 0;
  let best = Infinity;
  let l = 0;
  for (let r = 0; r < items.length; r++) {
    const t = items[r]![1];
    have.set(t, (have.get(t) ?? 0) + 1);
    if (have.get(t) === 1) formed++;
    while (formed === k) {
      best = Math.min(best, items[r]![0] - items[l]![0]);
      const lt = items[l]![1];
      have.set(lt, have.get(lt)! - 1);
      if (have.get(lt) === 0) formed--;
      l++;
    }
  }
  return best === Infinity ? null : best;
}

/** Whether phrase terms appear as a consecutive run somewhere in the body. */
function phraseAdjacent(posLists: number[][]): boolean {
  const first = posLists[0];
  if (!first || first.length === 0) return false;
  const sets = posLists.map((p) => new Set(p));
  for (const start of first) {
    let ok = true;
    for (let i = 1; i < posLists.length; i++) {
      if (!sets[i]!.has(start + i)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Score and rank documents for a set of positive term groups. Applies BM25F
 * field weighting, exact/prefix/fuzzy tiering (via group weights and
 * max-over-variants semantics), coverage, recency, and a proximity/phrase
 * rescoring pass over the top candidates.
 */
export function rank(input: RankInput): ScoredDoc[] {
  const { index, groups, phrases, now, limit, allow, restrictFields } = input;
  const n = index.docCount;
  if (n === 0) return [];

  const avgLen: number[] = [];
  for (let f = 0; f < FIELD_COUNT; f++) avgLen[f] = index.avgFieldLength(f);

  const accum = new Map<number, DocAcc>();

  for (const group of groups) {
    // Best (max) contribution per doc across this group's variants.
    const groupBest = new Map<number, { score: number; term: string; positions: number[] }>();

    for (const variant of group.variants) {
      const entry = index.getPostings(variant);
      if (!entry) continue;
      const termIdf = idf(n, entry.df);
      const p = entry.postings;
      let i = 0;
      const len = p.length;
      while (i < len) {
        const docId = p[i++]!;
        const fieldMask = p[i++]!;

        // Walk tf per set field, accumulating the BM25F normalized term freq.
        let tnorm = 0;
        const entryDoc = index.docEntry(docId);
        for (let f = 0; f < FIELD_COUNT; f++) {
          if (fieldMask & (1 << f)) {
            const tf = p[i++]!;
            // Always advance the cursor past every field's tf, but only score
            // the fields allowed by restrictFields (title-only search).
            if (entryDoc && (!restrictFields || restrictFields.has(f))) {
              const b = RANK.fieldB[f]!;
              const avg = avgLen[f]!;
              const norm = avg > 0 ? entryDoc.fieldLengths[f]! / avg : 1;
              const denom = 1 - b + b * norm;
              tnorm += (RANK.fieldWeight[f]! * tf) / denom;
            }
          }
        }

        let positions: number[] = [];
        if (fieldMask & BODY_BIT) {
          const posCount = p[i++]!;
          positions = p.slice(i, i + posCount);
          i += posCount;
        }

        if (!entryDoc || entryDoc.deleted) continue;
        if (allow && !allow(docId)) continue;
        if (tnorm === 0) continue; // matched only in restricted-out fields

        const contribution = (termIdf * tnorm) / (RANK.k1 + tnorm);
        const cur = groupBest.get(docId);
        if (!cur || contribution > cur.score) {
          groupBest.set(docId, { score: contribution, term: variant, positions });
        }
      }
    }

    for (const [docId, best] of groupBest) {
      let acc = accum.get(docId);
      if (!acc) {
        acc = { base: 0, groupsMatched: 0, matched: [], positions: new Map() };
        accum.set(docId, acc);
      }
      acc.base += best.score * group.weight;
      acc.groupsMatched++;
      acc.matched.push(best.term);
      if (best.positions.length > 0) acc.positions.set(best.term, best.positions);
    }
  }

  // Finalize: coverage + recency for every candidate.
  const scored: Array<{ docId: number; score: number; acc: DocAcc }> = [];
  for (const [docId, acc] of accum) {
    const coverage = 1 + RANK.coverage * (acc.groupsMatched - 1);
    const entryDoc = index.docEntry(docId)!;
    const ageDays = Math.max(0, (now - entryDoc.mtime) / DAY_MS);
    const recency = 1 + RANK.recencyR * Math.exp(-ageDays / RANK.recencyHalfLifeDays);
    scored.push({ docId, score: acc.base * coverage * recency, acc });
  }

  scored.sort((a, b) => b.score - a.score);

  // Proximity + phrase rescoring on the top candidates only.
  const rescoreCount = Math.min(RANK.rescoreTop, scored.length);
  for (let r = 0; r < rescoreCount; r++) {
    const s = scored[r]!;
    const posLists = [...s.acc.positions.values()].filter((p) => p.length > 0);

    if (posLists.length >= 2) {
      const win = minWindow(posLists);
      if (win !== null && win <= RANK.proximityWindow) {
        s.score *= 1 + RANK.proximityMax * (1 - win / RANK.proximityWindow);
      }
    }

    for (const phrase of phrases) {
      const lists = phrase.map((t) => s.acc.positions.get(t) ?? []);
      if (lists.every((l) => l.length > 0) && phraseAdjacent(lists)) {
        s.score *= 1 + RANK.phraseBonus;
      }
    }
  }

  if (rescoreCount > 0) scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => ({
    docId: s.docId,
    score: s.score,
    matched: [...new Set(s.acc.matched)],
  }));
}
