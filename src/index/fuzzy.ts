export interface FuzzyMatch {
  term: string;
  dist: number;
}

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

  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur: number[] = new Array<number>(lb + 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[lb]! <= max ? prev[lb]! : max + 1;
}

/**
 * Scan a term list for entries within `maxDist` edits of `target`, cheaply
 * pre-filtered by length gap. Excludes the exact term (handled by the exact
 * tier). Sorted by distance, then alphabetically. This only runs as a fallback
 * when exact+prefix matching is sparse, so the linear scan is off the hot path.
 */
export function fuzzyCandidates(target: string, terms: readonly string[], maxDist: number): FuzzyMatch[] {
  const out: FuzzyMatch[] = [];
  for (const term of terms) {
    if (term === target) continue;
    if (Math.abs(term.length - target.length) > maxDist) continue;
    const dist = boundedLevenshtein(target, term, maxDist);
    if (dist <= maxDist) out.push({ term, dist });
  }
  out.sort((a, b) => a.dist - b.dist || (a.term < b.term ? -1 : 1));
  return out;
}
