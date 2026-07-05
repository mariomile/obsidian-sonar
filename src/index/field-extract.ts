import { fold, tokenize } from './tokenizer.ts';
import { FIELD, FIELD_COUNT } from './fields.ts';
import type { FieldInput } from './inverted-index.ts';

/**
 * The subset of Obsidian's CachedMetadata that Sonar indexes. The service
 * layer maps a real `CachedMetadata` into this shape so this module stays
 * pure and testable without Obsidian.
 */
export interface NoteMeta {
  headings?: Array<{ heading: string; level: number }>;
  /** Inline tags, Obsidian-style with a leading '#'. */
  tags?: string[];
  frontmatter?: Record<string, unknown>;
}

export interface ExtractInput {
  basename: string;
  content: string;
  meta: NoteMeta;
}

export interface ExtractOutput {
  fields: FieldInput[];
  /** Folded tag strings (no '#'), deduped — for the `tag:` filter. */
  tags: string[];
}

const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
/** Frontmatter keys that own dedicated fields or are pure Obsidian plumbing. */
const SKIP_FM_KEYS = new Set(['aliases', 'tags', 'cssclass', 'cssclasses', 'position']);

/** Strip a leading YAML frontmatter block so it isn't indexed twice. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_BLOCK, '');
}

function termsOnly(text: string): string[] {
  return tokenize(text).map((t) => t.text);
}

/** Recursively collect string/number leaves from a frontmatter value. */
function flattenStrings(value: unknown, out: string[]): void {
  if (value == null) return;
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number' || typeof value === 'boolean') out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) flattenStrings(v, out);
  else if (typeof value === 'object') for (const v of Object.values(value)) flattenStrings(v, out);
}

function asStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return [value];
  return [];
}

/**
 * Turn a note's content + metadata into per-field token streams (plus the
 * folded tag list). Everything routes through the shared tokenizer, so query
 * terms match. Only the BODY field carries positions.
 */
export function extractFields(input: ExtractInput): ExtractOutput {
  const { basename, content, meta } = input;
  const fm = meta.frontmatter ?? {};

  // Tags: inline (#foo) + frontmatter `tags`, folded, deduped, no '#'.
  const tags: string[] = [];
  const seenTags = new Set<string>();
  const addTag = (raw: string): void => {
    const t = fold(raw.replace(/^#/, '')).trim();
    if (t && !seenTags.has(t)) {
      seenTags.add(t);
      tags.push(t);
    }
  };
  for (const t of meta.tags ?? []) addTag(t);
  for (const t of asStringArray(fm.tags)) addTag(t);

  // Aliases from frontmatter.
  const aliasText = asStringArray(fm.aliases).join(' ');

  // Headings split by level.
  const h1: string[] = [];
  const h2h3: string[] = [];
  for (const h of meta.headings ?? []) {
    (h.level <= 1 ? h1 : h2h3).push(h.heading);
  }

  // Frontmatter values, excluding dedicated/plumbing keys.
  const fmValues: string[] = [];
  for (const [key, value] of Object.entries(fm)) {
    if (SKIP_FM_KEYS.has(key)) continue;
    flattenStrings(value, fmValues);
  }

  // TAGS field terms come from tokenizing the tag strings (career/job → career, job).
  const tagFieldTerms: string[] = [];
  for (const t of tags) tagFieldTerms.push(...termsOnly(t));

  const bodyTokens = tokenize(stripFrontmatter(content));

  const fields = new Array<FieldInput>(FIELD_COUNT);
  fields[FIELD.BASENAME] = { terms: termsOnly(basename) };
  fields[FIELD.ALIASES] = { terms: termsOnly(aliasText) };
  fields[FIELD.H1] = { terms: termsOnly(h1.join(' ')) };
  fields[FIELD.H2H3] = { terms: termsOnly(h2h3.join(' ')) };
  fields[FIELD.TAGS] = { terms: tagFieldTerms };
  fields[FIELD.FRONTMATTER] = { terms: termsOnly(fmValues.join(' ')) };
  fields[FIELD.BODY] = {
    terms: bodyTokens.map((t) => t.text),
    positions: bodyTokens.map((t) => t.pos),
  };

  return { fields, tags };
}
