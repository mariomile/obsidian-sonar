export type ModeSigil = '' | '>' | '+' | '?';

/** A single actionable row produced by a non-search mode. */
export interface OmniRow {
  /** Stable identity for a row (command id, or a synthetic key). Modes set it
   *  and tests assert on it; the modal currently keys selection by list index,
   *  so this is reserved for future stable-across-keystroke selection. */
  key: string;
  /** lucide icon id; the modal applies the per-mode accent to it. */
  icon: string;
  main: string;
  sub?: string;
  /** Right-aligned hint (hotkey, "→ Exo"). */
  aux?: string;
  /** Non-actionable preview row (empty query / unavailable dependency). */
  disabled?: boolean;
  run(newTab: boolean): void | Promise<void>;
}

/** A non-search input mode, chosen by a leading sigil. */
export interface Mode {
  sigil: ModeSigil;
  chipLabel: string;
  /** CSS custom-property name for the per-mode accent, e.g. '--sonar-accent-cmd'. */
  accent: string;
  placeholder: string;
  rows(stripped: string): OmniRow[] | Promise<OmniRow[]>;
}
