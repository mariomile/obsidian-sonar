import { fold, tokenize } from './tokenizer.ts';

export interface QueryTerm {
  /** Folded positive term. */
  term: string;
  /** Also match as a prefix (the last token being typed). */
  prefix: boolean;
}

export interface ParsedQuery {
  /** Positive plain terms (deduped). */
  terms: QueryTerm[];
  /** Quoted phrases, each a sequence of folded tokens. */
  phrases: string[][];
  /** Folded terms whose presence excludes a document. */
  exclusions: string[];
  /** Folded path substrings a document's path must contain (all of them). */
  pathFilters: string[];
  /** Folded tag prefixes a document must carry (all of them). */
  tagFilters: string[];
  /** Original query string. */
  raw: string;
}

interface Clause {
  kind: 'word' | 'phrase';
  text: string;
  /** True only for the final clause when there is no trailing whitespace. */
  isLast: boolean;
}

/**
 * Split the raw query into clauses, honoring double quotes. A run inside
 * quotes is one phrase clause (an unterminated quote runs to end of input);
 * everything else splits on whitespace into word clauses. The final clause is
 * flagged `isLast` only when the query does not end in whitespace — that's the
 * signal that the user is mid-word and wants prefix matching.
 */
function splitClauses(raw: string): Clause[] {
  const clauses: Array<{ kind: 'word' | 'phrase'; text: string; end: number }> = [];
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const ch = raw[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      i++;
      const start = i;
      while (i < n && raw[i] !== '"') i++;
      const text = raw.slice(start, i);
      const closed = i < n;
      if (closed) i++; // consume closing quote
      clauses.push({ kind: 'phrase', text, end: i });
    } else {
      const start = i;
      while (i < n && !/\s/.test(raw[i]!) && raw[i] !== '"') i++;
      clauses.push({ kind: 'word', text: raw.slice(start, i), end: i });
    }
  }
  const endsWithSpace = n > 0 && /\s/.test(raw[n - 1]!);
  return clauses.map((c, idx) => ({
    kind: c.kind,
    text: c.text,
    isLast: idx === clauses.length - 1 && !endsWithSpace,
  }));
}

function foldedTokens(text: string): string[] {
  return tokenize(text).map((t) => t.text);
}

/**
 * Parse a raw query string into structured terms, phrases, exclusions and
 * filters. Everything is folded through the shared tokenizer so query terms
 * match indexed terms exactly.
 */
export function parseQuery(raw: string): ParsedQuery {
  const terms: QueryTerm[] = [];
  const termIndex = new Map<string, number>();
  const phrases: string[][] = [];
  const exclusions: string[] = [];
  const pathFilters: string[] = [];
  const tagFilters: string[] = [];

  const addTerm = (term: string, prefix: boolean): void => {
    const existing = termIndex.get(term);
    if (existing === undefined) {
      termIndex.set(term, terms.length);
      terms.push({ term, prefix });
    } else if (prefix) {
      terms[existing]!.prefix = true;
    }
  };

  for (const clause of splitClauses(raw)) {
    if (clause.kind === 'phrase') {
      const tokens = foldedTokens(clause.text);
      if (tokens.length > 0) phrases.push(tokens);
      continue;
    }

    const word = clause.text;
    if (word.startsWith('-')) {
      for (const t of foldedTokens(word.slice(1))) exclusions.push(t);
      continue;
    }
    if (word.startsWith('path:')) {
      const value = fold(word.slice('path:'.length)).trim();
      if (value) pathFilters.push(value);
      continue;
    }
    if (word.startsWith('tag:')) {
      const value = fold(word.slice('tag:'.length).replace(/^#/, '')).trim();
      if (value) tagFilters.push(value);
      continue;
    }

    for (const t of foldedTokens(word)) addTerm(t, clause.isLast);
  }

  return { terms, phrases, exclusions, pathFilters, tagFilters, raw };
}
