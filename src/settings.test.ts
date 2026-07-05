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
});
