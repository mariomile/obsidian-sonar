import { describe, it, expect } from 'vitest';
import { iconFor } from './icons.ts';

describe('iconFor', () => {
  it('maps known extensions', () => {
    expect(iconFor('pdf', 'pdf')).toBe('file-type');
    expect(iconFor('canvas', 'md')).toBe('layout-dashboard');
    expect(iconFor('png', 'image')).toBe('image');
    expect(iconFor('zip', 'md')).toBe('file-archive');
  });

  it('falls back to docType when ext unknown', () => {
    expect(iconFor('xyz', 'md')).toBe('file-text');
    expect(iconFor(undefined, 'image')).toBe('image');
  });

  it('final fallback is a generic file', () => {
    expect(iconFor('xyz', 'md')).toBe('file-text'); // docType md → file-text
    expect(iconFor('xyz', undefined as never)).toBe('file');
  });
});
