import { describe, it, expect } from 'vitest';
import { parseSigil } from './parse.ts';

describe('parseSigil', () => {
  it('returns search mode for plain text', () => {
    expect(parseSigil('hello world')).toEqual({ sigil: '', stripped: 'hello world' });
  });
  it('detects each sigil and strips it with leading whitespace', () => {
    expect(parseSigil('> annotate')).toEqual({ sigil: '>', stripped: 'annotate' });
    expect(parseSigil('+idea')).toEqual({ sigil: '+', stripped: 'idea' });
    expect(parseSigil('?  riassumi')).toEqual({ sigil: '?', stripped: 'riassumi' });
  });
  it('treats a bare sigil as an empty stripped query', () => {
    expect(parseSigil('>')).toEqual({ sigil: '>', stripped: '' });
  });
  it('does not treat a sigil mid-string as a mode', () => {
    expect(parseSigil('a > b')).toEqual({ sigil: '', stripped: 'a > b' });
  });
});
