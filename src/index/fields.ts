/**
 * The document fields, in weight order. The numeric values are used as bit
 * positions in a posting's field mask, so they must stay stable and dense.
 * (A `const enum` would be cleaner but is disallowed under isolatedModules.)
 */
export const FIELD = {
  BASENAME: 0,
  ALIASES: 1,
  H1: 2,
  H2H3: 3,
  TAGS: 4,
  FRONTMATTER: 5,
  BODY: 6,
} as const;

export type FieldId = (typeof FIELD)[keyof typeof FIELD];

export const FIELD_COUNT = 7;
export const BODY_FIELD = FIELD.BODY;

export const FIELD_NAMES = [
  'basename',
  'aliases',
  'h1',
  'h2h3',
  'tags',
  'frontmatter',
  'body',
] as const;

export type DocType = 'md' | 'pdf' | 'image' | 'html';
