import type { Mode, OmniRow } from './types.ts';
import { isTaskLine } from '../../service/capture.ts';

/** `+` mode: the rest of the line is captured to today's daily note. */
export class CaptureMode implements Mode {
  readonly sigil = '+' as const;
  readonly chipLabel = 'Capture';
  readonly accent = '--sonar-accent-cap';
  readonly placeholder = 'Capture a thought or [ ] task…';

  constructor(
    private readonly commit: (text: string) => Promise<void>,
    private readonly now: () => number,
    private readonly onDone: () => void,
  ) {}

  rows(stripped: string): OmniRow[] {
    const text = stripped.trim();
    if (!text) {
      return [{ key: '__capture', icon: 'plus', main: 'Type to capture…', sub: '→ Daily · 🌱 Capture', disabled: true, run: () => {} }];
    }
    const sub = isTaskLine(text) ? '→ Task · 📅 today' : '→ Daily · 🌱 Capture';
    return [{
      key: '__capture',
      icon: 'plus',
      main: text,
      sub,
      run: async () => {
        await this.commit(text);
        this.onDone();
      },
    }];
  }
}
