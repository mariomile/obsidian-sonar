/**
 * The one tokenizer, shared by indexing, query parsing, and excerpt
 * highlighting. Keeping a single implementation is what guarantees that a
 * query term matches an indexed term and that highlight offsets line up with
 * the source text.
 *
 * Bump TOKENIZER_VERSION whenever tokenization changes in a way that would make
 * a serialized index incompatible — the cache loader discards on mismatch.
 */
export const TOKENIZER_VERSION = 1;

export interface Token {
  /** Folded (diacritics-stripped, lowercased) term used for matching. */
  text: string;
  /** Inclusive start char offset in the ORIGINAL source text. */
  start: number;
  /** Exclusive end char offset in the ORIGINAL source text. */
  end: number;
  /** Token ordinal — used for phrase/proximity queries (body field only). */
  pos: number;
}

const COMBINING_MARKS = /\p{M}/gu;
const WORD_RUN = /[\p{L}\p{N}]+/gu;
const URL_SCHEME = /https?:\/\//giu;

/**
 * Normalize a term for matching: NFKD-decompose, drop combining marks
 * (`perché` → `perche`, `naïve` → `naive`), then lowercase. Applied
 * identically to indexed and query terms.
 */
export function fold(term: string): string {
  return term.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase();
}

function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

function isLower(ch: string): boolean {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase();
}

/**
 * Split a word run into case-boundary segments as [start, end) offsets
 * relative to the run. Splits only on case transitions, never on
 * letter/digit boundaries (keeps `utf8`, `mp3`, `h264`, `ES2021` intact):
 *  - lower/digit → Upper           : `chatGpt` → chat | Gpt
 *  - Upper → Upper followed by lower: `HTTPServer` → HTTP | Server
 */
function caseSegments(run: string): Array<[number, number]> {
  const bounds: number[] = [0];
  for (let i = 1; i < run.length; i++) {
    const prev = run[i - 1]!;
    const cur = run[i]!;
    const next = i + 1 < run.length ? run[i + 1]! : '';
    const camel = !isUpper(prev) && isUpper(cur);
    const acronym = isUpper(prev) && isUpper(cur) && isLower(next);
    if (camel || acronym) bounds.push(i);
  }
  bounds.push(run.length);
  const segments: Array<[number, number]> = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    segments.push([bounds[i]!, bounds[i + 1]!]);
  }
  return segments;
}

/**
 * Tokenize source text into folded terms with source offsets and position
 * ordinals. camelCase/acronym runs emit each segment as a subtoken at
 * consecutive positions, plus a compound token spanning the whole run at the
 * first subtoken's position (so both `chat gpt` as a phrase and `chatgpt` as a
 * single term match). Tokens whose folded form is length ≤ 1 are dropped.
 */
export function tokenize(text: string): Token[] {
  // Blank the URL scheme with equal-length spaces so `https`/`http` aren't
  // indexed as terms, while every other offset stays aligned to the source.
  const scan = text.replace(URL_SCHEME, (m) => ' '.repeat(m.length));

  const tokens: Token[] = [];
  let pos = 0;
  let match: RegExpExecArray | null;
  WORD_RUN.lastIndex = 0;
  while ((match = WORD_RUN.exec(scan)) !== null) {
    const runStart = match.index;
    const run = text.slice(runStart, runStart + match[0].length);
    const segments = caseSegments(run);
    const firstPos = pos;

    for (const [s, e] of segments) {
      const folded = fold(run.slice(s, e));
      if (folded.length > 1) {
        tokens.push({ text: folded, start: runStart + s, end: runStart + e, pos });
      }
      // Advance position even for dropped/short segments so phrase adjacency
      // reflects the source word order.
      pos++;
    }

    // Compound token for multi-segment runs (camelCase/acronyms), at the first
    // subtoken's position.
    if (segments.length > 1) {
      const folded = fold(run);
      if (folded.length > 1) {
        tokens.push({
          text: folded,
          start: runStart,
          end: runStart + run.length,
          pos: firstPos,
        });
      }
    }
  }
  return tokens;
}
