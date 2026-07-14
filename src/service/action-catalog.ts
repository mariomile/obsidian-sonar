import { subsequenceScore } from '../index/subseq.ts';

export interface CommandLike {
  id: string;
  name: string;
}

export interface SonarAction {
  id: string;
  title: string;
  source: string;
  destructive: boolean;
  run(): void;
  describe: string;
}

export type SonarActionInfo = Omit<SonarAction, 'run'>;

const DESTRUCTIVE = /delete|trash|remove|overwrite|clear|reset/i;

/** Builds the list of runnable actions from the host's command list. Injected
 *  with thin accessors so it needs no Obsidian `App` under test. Populates
 *  lazily and caches until `invalidate()`. */
export class ActionCatalog {
  private cache: SonarAction[] | null = null;

  constructor(
    private readonly load: () => CommandLike[],
    private readonly exec: (id: string) => void,
    private readonly hotkeyOf: (id: string) => string | undefined = () => undefined,
  ) {}

  all(): SonarAction[] {
    if (this.cache) return this.cache;
    this.cache = this.load().map((c) => {
      const source = c.id.includes(':') ? c.id.slice(0, c.id.indexOf(':')) : 'obsidian';
      return {
        id: c.id,
        title: c.name,
        source,
        destructive: DESTRUCTIVE.test(c.name) || DESTRUCTIVE.test(c.id),
        describe: `${c.name} (${source})`,
        run: () => this.exec(c.id),
      };
    });
    return this.cache;
  }

  hotkey(id: string): string | undefined {
    return this.hotkeyOf(id);
  }

  info(): SonarActionInfo[] {
    return this.all().map(({ id, title, source, destructive, describe }) => ({
      id,
      title,
      source,
      destructive,
      describe,
    }));
  }

  /** Execute an action by id. Returns whether it ran and whether it was
   *  flagged destructive, so callers can gate a confirmation. */
  run(id: string): { ok: boolean; destructive: boolean } {
    const action = this.all().find((a) => a.id === id);
    if (!action) return { ok: false, destructive: false };
    action.run();
    return { ok: true, destructive: action.destructive };
  }

  /** Subsequence-ranked matches over "title source", best first. */
  match(query: string): SonarAction[] {
    if (!query) return this.all();
    const scored: Array<{ a: SonarAction; s: number }> = [];
    for (const a of this.all()) {
      const s = subsequenceScore(query.toLowerCase(), `${a.title} ${a.source}`.toLowerCase());
      if (s !== null) scored.push({ a, s });
    }
    scored.sort((x, y) => y.s - x.s);
    return scored.map((x) => x.a);
  }

  invalidate(): void {
    this.cache = null;
  }
}
