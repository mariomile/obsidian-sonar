import { tokenize } from './tokenizer.ts';

export interface Excerpt {
  /** Display text (a window of the source), newlines collapsed to spaces. */
  text: string;
  /** Highlight ranges [start, end) into `text`. */
  ranges: Array<[number, number]>;
}

export interface ExcerptOptions {
  maxChars?: number;
  /** Per-term weights (idf); rarer terms pull the window toward them. */
  weights?: Map<string, number>;
}

interface MatchTok {
  start: number;
  end: number;
  term: string;
}

const DEFAULT_MAX = 160;

/**
 * Build a highlighted excerpt: re-tokenize the source with the shared
 * tokenizer, find the window that maximizes the summed weight of the distinct
 * matched terms it contains (so a cluster of rare terms beats a lone common
 * one), snap it to word boundaries, and return highlight ranges relative to
 * the returned text. Highlights point at the original surface text, preserving
 * case.
 */
export function makeExcerpt(
  source: string,
  terms: Iterable<string>,
  options: ExcerptOptions = {},
): Excerpt {
  const maxChars = options.maxChars ?? DEFAULT_MAX;
  const weights = options.weights;
  const termSet = terms instanceof Set ? terms : new Set(terms);

  const matches: MatchTok[] = [];
  for (const tok of tokenize(source)) {
    if (termSet.has(tok.text)) matches.push({ start: tok.start, end: tok.end, term: tok.text });
  }

  const len = source.length;
  if (matches.length === 0) {
    return finalize(source, 0, Math.min(len, maxChars), [], len);
  }

  // Best window: for each matched token as the anchor, extend while within
  // maxChars and sum the weight of distinct terms covered.
  const weightOf = (t: string): number => weights?.get(t) ?? 1;
  let best = { score: -1, start: matches[0]!.start, end: matches[0]!.end };
  for (let i = 0; i < matches.length; i++) {
    const anchor = matches[i]!.start;
    const seen = new Set<string>();
    let score = 0;
    let lastEnd = matches[i]!.end;
    for (let j = i; j < matches.length; j++) {
      if (matches[j]!.end - anchor > maxChars) break;
      if (!seen.has(matches[j]!.term)) {
        seen.add(matches[j]!.term);
        score += weightOf(matches[j]!.term);
      }
      lastEnd = matches[j]!.end;
    }
    if (score > best.score) best = { score, start: anchor, end: lastEnd };
  }

  // Pad to ~maxChars centered on the best span, then snap to word boundaries.
  const span = best.end - best.start;
  const pad = Math.max(0, maxChars - span);
  let ctxStart = Math.max(0, best.start - Math.floor(pad / 2));
  let ctxEnd = Math.min(len, best.end + Math.ceil(pad / 2));
  // Snap inward to word boundaries: trim a partial leading/trailing word rather
  // than extending into it (a very long token would otherwise swallow the cap).
  while (ctxStart > 0 && ctxStart < best.start && !/\s/.test(source[ctxStart - 1]!)) ctxStart++;
  while (ctxEnd < len && ctxEnd > best.end && !/\s/.test(source[ctxEnd]!)) ctxEnd--;

  const windowMatches = matches.filter((m) => m.start >= ctxStart && m.end <= ctxEnd);
  return finalize(source, ctxStart, ctxEnd, windowMatches, len);
}

function finalize(
  source: string,
  ctxStart: number,
  ctxEnd: number,
  windowMatches: MatchTok[],
  len: number,
): Excerpt {
  const prefix = ctxStart > 0 ? '…' : '';
  const suffix = ctxEnd < len ? '…' : '';
  // Replace each newline/tab with a single space (1:1) so display stays on one
  // line without shifting any offsets.
  const body = source.slice(ctxStart, ctxEnd).replace(/[\r\n\t]/g, ' ');
  const text = prefix + body + suffix;
  const offset = prefix.length - ctxStart;
  const ranges: Array<[number, number]> = windowMatches.map((m) => [m.start + offset, m.end + offset]);
  return { text, ranges };
}
