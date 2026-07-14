import type { Mode, OmniRow } from './types.ts';
import type { ActionCatalog } from '../../service/action-catalog.ts';
import type { FrecencyTracker } from '../../service/frecency.ts';

type ActionFrecency = Pick<FrecencyTracker, 'actionBoost' | 'bumpAction'>;

/** `>` mode: fuzzy over the action catalog, frecency-weighted, runs on Enter. */
export class CommandMode implements Mode {
  readonly sigil = '>' as const;
  readonly chipLabel = 'Command';
  readonly accent = '--sonar-accent-cmd';
  readonly placeholder = 'Run a command…';

  constructor(
    private readonly catalog: ActionCatalog,
    private readonly frecency: ActionFrecency,
    private readonly now: () => number,
    private readonly onRun: () => void,
  ) {}

  rows(stripped: string): OmniRow[] {
    const matches = this.catalog.match(stripped);
    if (matches.length === 0) {
      return [{ key: '__none', icon: 'terminal', main: 'No matching command', disabled: true, run: () => {} }];
    }
    const now = this.now();
    // match() is already subseq-ordered; stable-sort by frecency to break ties
    // without discarding match quality.
    const ranked = matches
      .map((a, i) => ({ a, i }))
      .sort((x, y) => this.frecency.actionBoost(y.a.id, now) - this.frecency.actionBoost(x.a.id, now) || x.i - y.i);
    return ranked.map(({ a }) => ({
      key: a.id,
      icon: 'terminal',
      main: a.title,
      sub: a.source,
      aux: this.catalog.hotkey(a.id),
      run: () => {
        this.frecency.bumpAction(a.id, this.now());
        a.run();
        this.onRun();
      },
    }));
  }
}
