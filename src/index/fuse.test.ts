import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './fuse.ts';

describe('reciprocalRankFusion', () => {
  it('ranks an item appearing high in multiple lists above single-list items', () => {
    const listA = [{ path: 'a' }, { path: 'b' }, { path: 'c' }];
    const listB = [{ path: 'b' }, { path: 'a' }, { path: 'd' }];
    const fused = reciprocalRankFusion([listA, listB]);
    // 'a' and 'b' appear near the top of both → they lead.
    expect(fused.slice(0, 2).map((f) => f.item.path).sort()).toEqual(['a', 'b']);
  });

  it('merges the same path from different lists once', () => {
    const fused = reciprocalRankFusion([[{ path: 'x' }], [{ path: 'x' }]]);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.item.path).toBe('x');
  });

  it('is order-stable for equal scores (keeps first-list encounter)', () => {
    const fused = reciprocalRankFusion([[{ path: 'p', tag: 1 }, { path: 'q', tag: 2 }]]);
    expect(fused.map((f) => f.item.path)).toEqual(['p', 'q']);
  });
});
