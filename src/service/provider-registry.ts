import { reciprocalRankFusion } from '../index/fuse.ts';
import type { ProviderResult, ProviderSection, SearchProvider } from '../types.ts';

export interface RegistryUpdate {
  /** RRF-merged results from all `fused` providers — the main ranked list. */
  fused: ProviderResult[];
  /** Non-fused providers, rendered as their own labeled sections. */
  sections: ProviderSection[];
}

export interface RegistryQueryOptions {
  limit: number;
  now: number;
  titleOnly?: boolean;
  pathFilters?: string[];
  tagFilters?: string[];
  /** Delay before `deep` providers fire, so typing doesn't spam them. */
  deepDelayMs?: number;
}

const DEFAULT_DEEP_DELAY = 400;

/**
 * Coordinates search providers for a single query: instant providers fire
 * immediately, deep providers after a typing pause, and results stream back
 * via `onUpdate` as each wave resolves. Returns a cancel function that aborts
 * in-flight provider calls and the pending deep timer.
 */
export class ProviderRegistry {
  private readonly providers: SearchProvider[] = [];

  register(provider: SearchProvider): void {
    this.providers.push(provider);
  }

  query(raw: string, opts: RegistryQueryOptions, onUpdate: (update: RegistryUpdate) => void): () => void {
    const controller = new AbortController();
    const { signal } = controller;
    const sections = new Map<string, ProviderSection>();

    const runWave = async (wave: SearchProvider[]): Promise<void> => {
      const settled = await Promise.all(
        wave.map(async (p) => {
          try {
            return {
              p,
              results: await p.search(raw, {
                limit: opts.limit,
                now: opts.now,
                signal,
                titleOnly: opts.titleOnly,
                pathFilters: opts.pathFilters,
                tagFilters: opts.tagFilters,
              }),
            };
          } catch {
            return { p, results: [] as ProviderResult[] };
          }
        }),
      );
      if (signal.aborted) return;
      for (const { p, results } of settled) {
        sections.set(p.id, { providerId: p.id, label: p.label, fused: p.fused, results });
      }
      onUpdate(this.assemble(sections, opts.limit));
    };

    const available = this.providers.filter((p) => p.isAvailable());
    const instant = available.filter((p) => p.mode === 'instant');
    const deep = available.filter((p) => p.mode === 'deep');

    void runWave(instant);

    let deepTimer: ReturnType<typeof setTimeout> | null = null;
    if (deep.length > 0) {
      deepTimer = setTimeout(() => {
        if (!signal.aborted) void runWave(deep);
      }, opts.deepDelayMs ?? DEFAULT_DEEP_DELAY);
    }

    return () => {
      controller.abort();
      if (deepTimer) clearTimeout(deepTimer);
    };
  }

  private assemble(sections: Map<string, ProviderSection>, limit: number): RegistryUpdate {
    const fusedLists: ProviderResult[][] = [];
    const extraSections: ProviderSection[] = [];
    for (const section of sections.values()) {
      if (section.fused) fusedLists.push(section.results);
      else extraSections.push(section);
    }
    const fused = reciprocalRankFusion(fusedLists)
      .map((f) => f.item)
      .slice(0, limit);
    return { fused, sections: extraSections };
  }
}
