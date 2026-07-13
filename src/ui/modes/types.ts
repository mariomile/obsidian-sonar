export type ModeSigil = '' | '>' | '+' | '?';

/** A single actionable row produced by a non-search mode. */
export interface OmniRow {
  /** Stable key for selection + frecency (command id, or a synthetic key). */
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
