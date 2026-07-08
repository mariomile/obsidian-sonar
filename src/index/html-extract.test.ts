import { describe, it, expect } from 'vitest';
import { htmlToText } from './html-extract.ts';

describe('htmlToText', () => {
  it('extracts visible text and drops tags', () => {
    const { text } = htmlToText('<p>Hello <b>world</b></p>');
    expect(text).toBe('Hello world');
  });

  it('removes script and style contents', () => {
    const { text } = htmlToText(
      '<style>.x{color:red}</style><script>alert(1)</script><p>keep</p>',
    );
    expect(text).toBe('keep');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color');
  });

  it('captures the title', () => {
    const { title } = htmlToText(
      '<html><head><title>GTM Gravity</title></head><body>x</body></html>',
    );
    expect(title).toBe('GTM Gravity');
  });

  it('returns null title when absent', () => {
    expect(htmlToText('<p>x</p>').title).toBeNull();
  });

  it('decodes common entities and collapses whitespace', () => {
    const { text } = htmlToText('<p>a &amp; b\n\n   c&nbsp;d</p>');
    expect(text).toBe('a & b c d');
  });
});
