import { describe, expect, it } from 'vitest';
import { makeExcerpt } from './excerpt.ts';

/** Extract the highlighted surfaces from an excerpt for assertions. */
function highlights(text: string, terms: string[], maxChars = 160): string[] {
  const ex = makeExcerpt(text, terms, { maxChars });
  return ex.ranges.map(([s, e]) => ex.text.slice(s, e));
}

describe('makeExcerpt — matching & ranges', () => {
  it('highlights the matched term preserving original case', () => {
    const ex = makeExcerpt('A Brown fox', ['brown']);
    expect(ex.ranges).toHaveLength(1);
    const [s, e] = ex.ranges[0]!;
    expect(ex.text.slice(s, e)).toBe('Brown');
  });

  it('highlights every occurrence within the window', () => {
    expect(highlights('cat and cat and dog', ['cat'])).toEqual(['cat', 'cat']);
  });

  it('returns the head of the text when nothing matches', () => {
    const ex = makeExcerpt('nothing to see here at all', ['zebra'], { maxChars: 12 });
    expect(ex.ranges).toEqual([]);
    expect(ex.text.startsWith('nothing')).toBe(true);
  });
});

describe('makeExcerpt — window selection', () => {
  it('centers on the densest cluster of matched terms', () => {
    const filler = 'lorem ipsum dolor sit amet '.repeat(4);
    const text = `${filler} alpha beta ${filler}`;
    const ex = makeExcerpt(text, ['alpha', 'beta'], { maxChars: 40 });
    expect(ex.text).toContain('alpha');
    expect(ex.text).toContain('beta');
  });

  it('prefers the window with the highest total term weight (rare terms win)', () => {
    const text = 'common word here. then rare gem appears far away in this longer passage.';
    const weights = new Map([
      ['common', 1],
      ['rare', 10],
      ['gem', 10],
    ]);
    const ex = makeExcerpt(text, ['common', 'rare', 'gem'], { maxChars: 24, weights });
    expect(ex.text).toContain('rare');
    expect(ex.text).toContain('gem');
  });
});

describe('makeExcerpt — ellipsis', () => {
  it('adds a leading ellipsis and offsets ranges past it', () => {
    const text = 'x'.repeat(100) + ' target ' + 'y'.repeat(100);
    const ex = makeExcerpt(text, ['target'], { maxChars: 30 });
    expect(ex.text.startsWith('…')).toBe(true);
    expect(ex.text.endsWith('…')).toBe(true);
    const [s, e] = ex.ranges[0]!;
    expect(ex.text.slice(s, e)).toBe('target');
  });

  it('collapses newlines to spaces without breaking offsets', () => {
    const ex = makeExcerpt('line one\nhas target\nend', ['target']);
    expect(ex.text).not.toContain('\n');
    const [s, e] = ex.ranges[0]!;
    expect(ex.text.slice(s, e)).toBe('target');
  });
});
