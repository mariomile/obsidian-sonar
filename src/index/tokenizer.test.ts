import { describe, expect, it } from 'vitest';
import { fold, tokenize } from './tokenizer.ts';

/** Compact view of a token for assertions. */
function shape(text: string): Array<{ text: string; pos: number; span: [number, number] }> {
  return tokenize(text).map((t) => ({ text: t.text, pos: t.pos, span: [t.start, t.end] }));
}

/** Just the folded terms, in order. */
function terms(text: string): string[] {
  return tokenize(text).map((t) => t.text);
}

describe('fold', () => {
  it('folds Italian diacritics', () => {
    expect(fold('perché')).toBe('perche');
    expect(fold('città')).toBe('citta');
    expect(fold('È')).toBe('e');
    expect(fold('naïve')).toBe('naive');
  });

  it('lowercases', () => {
    expect(fold('ChatGPT')).toBe('chatgpt');
    expect(fold('HELLO')).toBe('hello');
  });

  it('is idempotent', () => {
    expect(fold(fold('Perché'))).toBe('perche');
  });
});

describe('tokenize — basics', () => {
  it('splits words with sequential positions and source offsets', () => {
    expect(shape('hello world')).toEqual([
      { text: 'hello', pos: 0, span: [0, 5] },
      { text: 'world', pos: 1, span: [6, 11] },
    ]);
  });

  it('folds each token but keeps source offsets', () => {
    // "Café" folds to "cafe" (4 letters), source span still covers "Café".
    expect(shape('Café road')).toEqual([
      { text: 'cafe', pos: 0, span: [0, 4] },
      { text: 'road', pos: 1, span: [5, 9] },
    ]);
  });

  it('drops length-1 tokens everywhere', () => {
    expect(terms('a cat')).toEqual(['cat']);
    expect(terms('x')).toEqual([]);
  });

  it('splits Italian elisions and drops the orphan letter', () => {
    // "l'idea" → "l" (dropped, len 1) + "idea"
    expect(terms("l'idea")).toEqual(['idea']);
    // curly apostrophe behaves the same
    expect(terms('l’idea')).toEqual(['idea']);
  });

  it('treats markdown punctuation as boundaries', () => {
    expect(terms('# Heading, with **bold**!')).toEqual(['heading', 'with', 'bold']);
  });
});

describe('tokenize — camelCase / acronyms', () => {
  it('emits subtokens plus a compound at the first subtoken position', () => {
    expect(shape('ChatGPT')).toEqual([
      { text: 'chat', pos: 0, span: [0, 4] },
      { text: 'gpt', pos: 1, span: [4, 7] },
      { text: 'chatgpt', pos: 0, span: [0, 7] },
    ]);
  });

  it('handles acronym→Word boundaries (HTTPServer → HTTP | Server)', () => {
    expect(shape('HTTPServer')).toEqual([
      { text: 'http', pos: 0, span: [0, 4] },
      { text: 'server', pos: 1, span: [4, 10] },
      { text: 'httpserver', pos: 0, span: [0, 10] },
    ]);
  });

  it('keeps positions consistent for following words', () => {
    // chat@1, gpt@2, compound chatgpt@1, then model@3
    expect(shape('the ChatGPT model')).toEqual([
      { text: 'the', pos: 0, span: [0, 3] },
      { text: 'chat', pos: 1, span: [4, 8] },
      { text: 'gpt', pos: 2, span: [8, 11] },
      { text: 'chatgpt', pos: 1, span: [4, 11] },
      { text: 'model', pos: 3, span: [12, 17] },
    ]);
  });

  it('does not split all-uppercase runs', () => {
    expect(terms('GPT')).toEqual(['gpt']);
  });

  it('does not split letter/digit boundaries', () => {
    expect(terms('utf8 mp3 h264')).toEqual(['utf8', 'mp3', 'h264']);
  });
});

describe('tokenize — snake_case', () => {
  it('splits on underscore naturally without a compound', () => {
    expect(shape('foo_bar')).toEqual([
      { text: 'foo', pos: 0, span: [0, 3] },
      { text: 'bar', pos: 1, span: [4, 7] },
    ]);
  });
});

describe('tokenize — URLs', () => {
  it('strips the http(s) scheme but indexes host/path words', () => {
    expect(terms('see https://example.com/path')).toEqual([
      'see',
      'example',
      'com',
      'path',
    ]);
  });

  it('keeps offsets aligned after scheme stripping', () => {
    const toks = tokenize('https://a.io/docs');
    const example = toks.find((t) => t.text === 'docs');
    expect(example).toBeDefined();
    expect('https://a.io/docs'.slice(example!.start, example!.end)).toBe('docs');
  });
});

describe('tokenize — indexing/query symmetry', () => {
  it('produces the same folded terms for query and indexed content', () => {
    // The engine relies on this: a query is tokenized the same way as content.
    expect(terms('Perché ChatGPT')).toEqual(terms('perche chat gpt chatgpt'));
  });
});
