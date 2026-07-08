import { fold } from './tokenizer.ts';

const BOUNDARY_BEFORE = new Set(['-', '_', '/', '.', ' ']);

/** Is position `i` in the ORIGINAL (unfolded) candidate a word boundary? */
function isBoundary(original: string, i: number): boolean {
  if (i === 0) return true;
  const prev = original[i - 1]!;
  if (BOUNDARY_BEFORE.has(prev)) return true;
  // CamelCase: lower/digit → upper transition.
  const cur = original[i]!;
  return prev.toLowerCase() === prev && cur.toLowerCase() !== cur;
}

/**
 * fzf-style subsequence score. Greedy left-to-right match of every folded
 * query char against the folded candidate; returns null if the query is not a
 * subsequence. Score rewards consecutive runs and word-boundary starts, and
 * lightly penalizes leading gap so earlier/tighter matches rank higher.
 */
export function subsequenceScore(query: string, candidate: string): number | null {
  const q = fold(query);
  if (q.length === 0) return null;
  const c = fold(candidate);
  if (c.length === 0) return null;

  let ci = 0;
  let score = 0;
  let prevMatch = -2; // so the first match is never "consecutive"
  let firstMatch = -1;

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    let found = -1;
    for (let k = ci; k < c.length; k++) {
      if (c[k] === ch) {
        found = k;
        break;
      }
    }
    if (found === -1) return null;
    if (firstMatch === -1) firstMatch = found;

    let charScore = 1;
    if (found === prevMatch + 1) charScore += 3; // consecutive run
    if (isBoundary(candidate, found)) charScore += 4; // word/camel boundary
    score += charScore;

    prevMatch = found;
    ci = found + 1;
  }

  // Prefer matches that start earlier and are less spread out.
  score -= firstMatch * 0.1;
  score -= (prevMatch - firstMatch - (q.length - 1)) * 0.2; // total gap length

  // Whole-name signals dominate scattered subsequences: an exact basename beats
  // a prefix, which beats any interior match.
  if (c === q) score += 16;
  else if (c.startsWith(q)) score += 8;

  return score;
}
