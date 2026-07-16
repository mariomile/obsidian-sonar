import { fold } from '../index/tokenizer.ts';

export interface DateJumpMatch {
  /** Always-English display label, independent of which keyword matched. */
  label: 'Today' | 'Yesterday' | 'Tomorrow';
  /** Epoch ms for the target local calendar day (feed to dailyBasename/dailyNotePath). */
  targetMs: number;
}

const OFFSETS: Record<string, number> = {
  today: 0,
  oggi: 0,
  yesterday: -1,
  ieri: -1,
  tomorrow: 1,
  domani: 1,
};

const LABELS: Record<number, DateJumpMatch['label']> = {
  0: 'Today',
  [-1]: 'Yesterday',
  1: 'Tomorrow',
};

/**
 * Matches a search query that is *exactly* a relative-date keyword (English
 * or Italian) and resolves it to that local calendar day. Returns null for
 * anything else — no prefix or partial-word matching, so it never hijacks an
 * unrelated search (e.g. "yesterday's ideas", "tomato").
 */
export function matchDateKeyword(raw: string, now: number): DateJumpMatch | null {
  const key = fold(raw.trim());
  const offset = OFFSETS[key];
  if (offset === undefined) return null;
  const d = new Date(now);
  d.setDate(d.getDate() + offset); // local calendar day; DST-safe (setDate, not ms arithmetic)
  return { label: LABELS[offset]!, targetMs: d.getTime() };
}
