import { describe, expect, it } from 'vitest';
import { groupByRecency } from './time-buckets.ts';

// Fixed "now": 2026-07-06 12:00 local.
const NOW = new Date(2026, 6, 6, 12, 0, 0).getTime();
const at = (y: number, mo: number, d: number, h = 10): number => new Date(y, mo, d, h).getTime();

interface Item {
  id: string;
  mtime: number;
}

function grouped(items: Item[]): Array<[string, string[]]> {
  return groupByRecency(items, (i) => i.mtime, NOW).map((g) => [
    g.label,
    g.items.map((i) => i.id),
  ]);
}

describe('groupByRecency', () => {
  it('buckets items into Today / Yesterday / Past week / Past 30 days / Older', () => {
    const items: Item[] = [
      { id: 'today', mtime: at(2026, 6, 6, 9) },
      { id: 'yesterday', mtime: at(2026, 6, 5) },
      { id: 'threeDays', mtime: at(2026, 6, 3) },
      { id: 'twoWeeks', mtime: at(2026, 5, 22) },
      { id: 'old', mtime: at(2026, 3, 1) },
    ];
    expect(grouped(items)).toEqual([
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['Past week', ['threeDays']],
      ['Past 30 days', ['twoWeeks']],
      ['Older', ['old']],
    ]);
  });

  it('omits empty buckets and preserves input order within a bucket', () => {
    const items: Item[] = [
      { id: 'a', mtime: at(2026, 6, 6, 11) },
      { id: 'b', mtime: at(2026, 6, 6, 8) },
    ];
    expect(grouped(items)).toEqual([['Today', ['a', 'b']]]);
  });

  it('returns nothing for an empty input', () => {
    expect(groupByRecency([], () => 0, NOW)).toEqual([]);
  });
});
