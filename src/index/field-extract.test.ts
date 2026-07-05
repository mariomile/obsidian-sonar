import { describe, expect, it } from 'vitest';
import { extractFields, stripFrontmatter, type NoteMeta } from './field-extract.ts';
import { FIELD } from './fields.ts';

function termsOf(fields: ReturnType<typeof extractFields>['fields'], field: number): string[] {
  return fields[field]!.terms;
}

describe('stripFrontmatter', () => {
  it('removes a leading YAML block and keeps body offset intact for the rest', () => {
    const content = '---\ntitle: x\n---\nHello body';
    expect(stripFrontmatter(content)).toBe('Hello body');
  });

  it('returns content unchanged when there is no frontmatter', () => {
    expect(stripFrontmatter('# Heading\ntext')).toBe('# Heading\ntext');
  });
});

describe('extractFields — basename & aliases', () => {
  it('tokenizes the basename into the BASENAME field', () => {
    const { fields } = extractFields({ basename: 'GTM Strategy', content: '', meta: {} });
    expect(termsOf(fields, FIELD.BASENAME)).toEqual(['gtm', 'strategy']);
  });

  it('tokenizes frontmatter aliases into the ALIASES field', () => {
    const meta: NoteMeta = { frontmatter: { aliases: ['Go To Market', 'GTM'] } };
    const { fields } = extractFields({ basename: 'x', content: '', meta });
    expect(termsOf(fields, FIELD.ALIASES)).toEqual(['go', 'to', 'market', 'gtm']);
  });
});

describe('extractFields — headings', () => {
  it('routes H1 and H2/H3 to separate fields', () => {
    const meta: NoteMeta = {
      headings: [
        { heading: 'Big Title', level: 1 },
        { heading: 'Sub Section', level: 2 },
        { heading: 'Deep Bit', level: 3 },
      ],
    };
    const { fields } = extractFields({ basename: 'x', content: '', meta });
    expect(termsOf(fields, FIELD.H1)).toEqual(['big', 'title']);
    expect(termsOf(fields, FIELD.H2H3)).toEqual(['sub', 'section', 'deep', 'bit']);
  });
});

describe('extractFields — tags', () => {
  it('collects folded tag strings and tokenizes them into the TAGS field', () => {
    const meta: NoteMeta = {
      tags: ['#Reading'],
      frontmatter: { tags: ['career/job'] },
    };
    const { fields, tags } = extractFields({ basename: 'x', content: '', meta });
    expect(tags).toEqual(['reading', 'career/job']);
    expect(termsOf(fields, FIELD.TAGS)).toEqual(['reading', 'career', 'job']);
  });

  it('dedupes tags across inline and frontmatter sources', () => {
    const meta: NoteMeta = { tags: ['#career'], frontmatter: { tags: 'career' } };
    const { tags } = extractFields({ basename: 'x', content: '', meta });
    expect(tags).toEqual(['career']);
  });
});

describe('extractFields — frontmatter values', () => {
  it('indexes frontmatter string and wikilink values, excluding aliases/tags', () => {
    const meta: NoteMeta = {
      frontmatter: {
        aliases: ['ignored'],
        tags: ['ignored'],
        up: '[[Product MOC]]',
        status: 'active',
      },
    };
    const { fields } = extractFields({ basename: 'x', content: '', meta });
    const fm = termsOf(fields, FIELD.FRONTMATTER);
    expect(fm).toContain('product');
    expect(fm).toContain('moc');
    expect(fm).toContain('active');
    expect(fm).not.toContain('ignored');
  });
});

describe('extractFields — body', () => {
  it('tokenizes body without the frontmatter block and carries positions', () => {
    const content = '---\ntitle: x\n---\nHello brave world';
    const { fields } = extractFields({ basename: 'x', content, meta: {} });
    const body = fields[FIELD.BODY]!;
    expect(body.terms).toEqual(['hello', 'brave', 'world']);
    expect(body.positions).toEqual([0, 1, 2]);
  });
});
