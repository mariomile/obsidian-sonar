import { describe, it, expect } from 'vitest';
import { matchDateKeyword } from './date-jump.ts';
import { dailyBasename } from './capture.ts';

const NOW = Date.UTC(2026, 6, 16, 10, 0); // Thursday 2026-07-16

describe('matchDateKeyword', () => {
  it('matches "today" and "oggi" to the current day', () => {
    for (const kw of ['today', 'Today', 'oggi', 'OGGI']) {
      const m = matchDateKeyword(kw, NOW);
      expect(m?.label).toBe('Today');
      expect(dailyBasename(m!.targetMs)).toBe('16-07-2026');
    }
  });

  it('matches "yesterday" and "ieri" to the previous day', () => {
    for (const kw of ['yesterday', 'ieri']) {
      const m = matchDateKeyword(kw, NOW);
      expect(m?.label).toBe('Yesterday');
      expect(dailyBasename(m!.targetMs)).toBe('15-07-2026');
    }
  });

  it('matches "tomorrow" and "domani" to the next day', () => {
    for (const kw of ['tomorrow', 'domani']) {
      const m = matchDateKeyword(kw, NOW);
      expect(m?.label).toBe('Tomorrow');
      expect(dailyBasename(m!.targetMs)).toBe('17-07-2026');
    }
  });

  it('ignores whitespace padding', () => {
    expect(matchDateKeyword('  today  ', NOW)?.label).toBe('Today');
  });

  it('does not match partial words or unrelated queries', () => {
    expect(matchDateKeyword('tomato', NOW)).toBeNull();
    expect(matchDateKeyword("yesterday's ideas", NOW)).toBeNull();
    expect(matchDateKeyword('meeting notes', NOW)).toBeNull();
    expect(matchDateKeyword('', NOW)).toBeNull();
  });
});
