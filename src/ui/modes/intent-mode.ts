import type { Mode, OmniRow } from './types.ts';

/** `?` mode: hand the natural-language intent to Exo, which executes it using
 *  the Sonar action tools. This class only hands off the text. */
export class IntentMode implements Mode {
  readonly sigil = '?' as const;
  readonly chipLabel = 'Ask Exo';
  readonly accent = '--sonar-accent-int';
  readonly placeholder = 'Describe what you want done…';

  constructor(
    private readonly isAvailable: () => boolean,
    private readonly ask: (text: string) => void,
  ) {}

  rows(stripped: string): OmniRow[] {
    const text = stripped.trim();
    if (!this.isAvailable()) {
      return [{ key: '__intent', icon: 'sparkles', main: 'Ask Exo', sub: 'Exo not available', disabled: true, run: () => {} }];
    }
    if (!text) {
      return [{ key: '__intent', icon: 'sparkles', main: 'Describe what you want done…', disabled: true, run: () => {} }];
    }
    return [{
      key: '__intent',
      icon: 'sparkles',
      main: text,
      aux: '→ Exo',
      run: () => this.ask(text),
    }];
  }
}
