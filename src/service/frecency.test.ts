import { describe, it, expect } from 'vitest';
import { frecencyBoost } from './frecency.ts';

const NOW = 1000 * 86_400_000;

describe('frecencyBoost', () => {
  it('is neutral (1) with no history', () => {
    expect(frecencyBoost(undefined, NOW)).toBe(1);
    expect(frecencyBoost({ count: 0, lastOpened: NOW }, NOW)).toBe(1);
  });

  it('boosts a frequently and recently opened file above 1', () => {
    const b = frecencyBoost({ count: 15, lastOpened: NOW }, NOW);
    expect(b).toBeGreaterThan(1.1);
    expect(b).toBeLessThanOrEqual(1.3);
  });

  it('more opens yield a higher boost', () => {
    const few = frecencyBoost({ count: 2, lastOpened: NOW }, NOW);
    const many = frecencyBoost({ count: 15, lastOpened: NOW }, NOW);
    expect(many).toBeGreaterThan(few);
  });

  it('decays as the last open recedes', () => {
    const fresh = frecencyBoost({ count: 5, lastOpened: NOW }, NOW);
    const stale = frecencyBoost({ count: 5, lastOpened: NOW - 120 * 86_400_000 }, NOW);
    expect(fresh).toBeGreaterThan(stale);
    expect(stale).toBeGreaterThanOrEqual(1);
  });
});
