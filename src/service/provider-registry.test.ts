import { describe, expect, it } from 'vitest';
import { ProviderRegistry, type RegistryUpdate } from './provider-registry.ts';
import type { ProviderResult, SearchProvider } from '../types.ts';

const hit = (path: string): ProviderResult => ({
  path,
  basename: path,
  docType: 'md',
  score: 1,
  source: 'k',
  matched: ['x'],
});

describe('ProviderRegistry — two-pass results', () => {
  it('paints ranked results first, then again once enrich() fills excerpts', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const provider: SearchProvider = {
      id: 'k',
      label: 'K',
      mode: 'instant',
      fused: true,
      isAvailable: () => true,
      search: () => Promise.resolve([hit('a.md'), hit('b.md')]),
      enrich: async (results) => {
        await gate;
        return results.map((r) => ({ ...r, excerpt: { text: `about ${r.path}`, ranges: [] } }));
      },
    };
    const registry = new ProviderRegistry();
    registry.register(provider);
    const updates: RegistryUpdate[] = [];
    registry.query('x', { limit: 10, now: 0 }, (u) => updates.push(u));

    await new Promise((r) => setTimeout(r, 0));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.fused.map((r) => r.excerpt)).toEqual([undefined, undefined]);

    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(updates).toHaveLength(2);
    expect(updates[1]!.fused.map((r) => r.excerpt?.text)).toEqual(['about a.md', 'about b.md']);
  });

  it('drops the enrich pass when the query was cancelled', async () => {
    const provider: SearchProvider = {
      id: 'k',
      label: 'K',
      mode: 'instant',
      fused: true,
      isAvailable: () => true,
      search: () => Promise.resolve([hit('a.md')]),
      enrich: (results) => new Promise((r) => setTimeout(() => r(results), 5)),
    };
    const registry = new ProviderRegistry();
    registry.register(provider);
    const updates: RegistryUpdate[] = [];
    const cancel = registry.query('x', { limit: 10, now: 0 }, (u) => updates.push(u));
    await new Promise((r) => setTimeout(r, 0));
    cancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(updates).toHaveLength(1);
  });
});
