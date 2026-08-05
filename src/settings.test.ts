import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings.ts';

describe('parseSettings', () => {
  it('returns defaults for empty input', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps an invalid port back to the default', () => {
    expect(parseSettings({ httpPort: 0 }).httpPort).toBe(DEFAULT_SETTINGS.httpPort);
    expect(parseSettings({ httpPort: 70000 }).httpPort).toBe(DEFAULT_SETTINGS.httpPort);
    expect(parseSettings({ httpPort: 51361 }).httpPort).toBe(51361);
  });

  it('clamps maxResults to the 1..50 range', () => {
    expect(parseSettings({ maxResults: 0 }).maxResults).toBe(DEFAULT_SETTINGS.maxResults);
    expect(parseSettings({ maxResults: 100 }).maxResults).toBe(DEFAULT_SETTINGS.maxResults);
    expect(parseSettings({ maxResults: 10 }).maxResults).toBe(10);
  });

  it('preserves valid overrides', () => {
    const s = parseSettings({ httpEnabled: true, indexImages: true, showScoreDebug: true });
    expect(s.httpEnabled).toBe(true);
    expect(s.indexImages).toBe(true);
    expect(s.showScoreDebug).toBe(true);
  });

  it('keeps only a valid SHA-256 HTTP token hash', () => {
    const hash = 'a'.repeat(64);
    expect(parseSettings({ httpTokenHash: hash }).httpTokenHash).toBe(hash);
    expect(parseSettings({ httpTokenHash: 'raw-secret' }).httpTokenHash).toBe('');
  });

  it('defaults indexHtml to true and coerces it to boolean', () => {
    expect(parseSettings({}).indexHtml).toBe(true);
    expect(parseSettings({ indexHtml: 0 }).indexHtml).toBe(false);
  });

  it('defaults pullToSearchEnabled to true and accepts an override', () => {
    expect(parseSettings({}).pullToSearchEnabled).toBe(true);
    expect(parseSettings({ pullToSearchEnabled: false }).pullToSearchEnabled).toBe(false);
  });

  it('defaults bodyFuzzy to on-sparse and rejects unknown values', () => {
    expect(parseSettings({}).bodyFuzzy).toBe('on-sparse');
    expect(parseSettings({ bodyFuzzy: 'always' }).bodyFuzzy).toBe('always');
    expect(parseSettings({ bodyFuzzy: 'off' }).bodyFuzzy).toBe('off');
    expect(parseSettings({ bodyFuzzy: 'nonsense' }).bodyFuzzy).toBe('on-sparse');
  });

  it('defaults browseSort to relevance and accepts each valid value', () => {
    expect(parseSettings({}).browseSort).toBe('relevance');
    expect(parseSettings({ browseSort: 'relevance' }).browseSort).toBe('relevance');
    expect(parseSettings({ browseSort: 'created' }).browseSort).toBe('created');
    expect(parseSettings({ browseSort: 'modified' }).browseSort).toBe('modified');
    expect(parseSettings({ browseSort: 'viewed' }).browseSort).toBe('viewed');
  });

  it('falls back browseSort to relevance for a missing or corrupt value', () => {
    expect(parseSettings({ browseSort: undefined }).browseSort).toBe('relevance');
    expect(parseSettings({ browseSort: 'nonsense' }).browseSort).toBe('relevance');
    expect(parseSettings({ browseSort: 123 }).browseSort).toBe('relevance');
    expect(parseSettings({ browseSort: null }).browseSort).toBe('relevance');
  });
});
