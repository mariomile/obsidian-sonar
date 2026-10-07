export interface FuzzyMatch {
  term: string;
  dist: number;
}

// Two DP rows reused across calls: the fuzzy scan compares the query against
// every term, so allocating rows per comparison dominated its cost.
let prevRow = new Int32Array(64);
let curRow = new Int32Array(64);

/**
 * Levenshtein distance with an early bail-out: if any DP row's minimum exceeds
 * `max`, the true distance is > max and we return `max + 1`. Terms are short
 * (< ~20 chars), so the plain DP is already cheap; the bound just skips the
 * tail of clearly-too-far comparisons.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;

  if (prevRow.length <= lb) {
    prevRow = new Int32Array(lb + 1);
    curRow = new Int32Array(lb + 1);
  }
  let prev = prevRow;
  let cur = curRow;
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[lb]! <= max ? prev[lb]! : max + 1;
}

/** Which characters a term contains, folded into 32 bits. */
function charMask(term: string): number {
  let m = 0;
  for (let i = 0; i < term.length; i++) m |= 1 << (term.charCodeAt(i) & 31);
  return m;
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Char masks per term list, rebuilt when the list grows (terms are only ever
 *  inserted, and a reload swaps in a new array). */
const maskCache = new WeakMap<readonly string[], Uint32Array>();

function masksFor(terms: readonly string[]): Uint32Array {
  let masks = maskCache.get(terms);
  if (!masks || masks.length !== terms.length) {
    masks = new Uint32Array(terms.length);
    for (let i = 0; i < terms.length; i++) masks[i] = charMask(terms[i]!);
    maskCache.set(terms, masks);
  }
  return masks;
}

/**
 * Scan a term list for entries within `maxDist` edits of `target`, cheaply
 * pre-filtered by length gap. Excludes the exact term (handled by the exact
 * tier). Sorted by distance, then alphabetically. This only runs as a fallback
 * when exact+prefix matching is sparse, so the linear scan is off the hot path.
 */
export function fuzzyCandidates(target: string, terms: readonly string[], maxDist: number): FuzzyMatch[] {
  const out: FuzzyMatch[] = [];
  const masks = masksFor(terms);
  const targetMask = charMask(target);
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i]!;
    if (Math.abs(term.length - target.length) > maxDist) continue;
    // Each edit adds or removes at most two distinct characters, so a term
    // whose character set differs by more than 2·maxDist can't be close.
    if (popcount(masks[i]! ^ targetMask) > 2 * maxDist) continue;
    if (term === target) continue;
    const dist = boundedLevenshtein(target, term, maxDist);
    if (dist <= maxDist) out.push({ term, dist });
  }
  out.sort((a, b) => a.dist - b.dist || (a.term < b.term ? -1 : 1));
  return out;
}
