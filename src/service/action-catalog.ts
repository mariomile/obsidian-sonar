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

/** Verbs that destroy persistent data regardless of object. */
const STRONG_VERBS = /\b(delete|trash|erase|wipe|purge|overwrite)\b/i;
/** Verbs that are destructive only when aimed at persistent data — "clear
 *  formatting" and "reset zoom" are transient UI state, "clear history" is not. */
const WEAK_VERBS = /\b(remove|clear|reset|discard)\b/i;
const DATA_NOUNS = /\b(files?|notes?|folders?|vaults?|attachments?|history|data|database|cache|backups?|all)\b/i;
/** Commands whose title leads with a view verb only display something —
 *  "Show trash" opens the trash pane, it doesn't trash anything. */
const VIEW_VERBS = /^(show|open|view|reveal)\b/i;

/** Tiered destructive heuristic over a command's "name + id" text. The old
 *  single regex over-flagged: any `clear`/`reset`/`remove` counted, so benign
 *  commands gated a confirmation. */
export function isDestructive(text: string): boolean {
  if (VIEW_VERBS.test(text)) return false;
  if (STRONG_VERBS.test(text)) return true;
  return WEAK_VERBS.test(text) && DATA_NOUNS.test(text);
}

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
        destructive: isDestructive(`${c.name} ${c.id}`),
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
