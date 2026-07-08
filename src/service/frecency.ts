import type { App, EventRef } from 'obsidian';

const DAY = 86_400_000;
/** Frequency saturates around this many opens. */
const SATURATION_OPENS = 20;
/** Half-life for how quickly a file's "recently opened" weight decays. */
const OPEN_HALFLIFE_DAYS = 30;
/** Max multiplier a maximally-frecent file earns. */
const MAX_BOOST = 0.3;
const SAVE_DEBOUNCE_MS = 5_000;

export interface FrecencyEntry {
  count: number;
  lastOpened: number;
}

/**
 * Frecency multiplier (1 .. 1+MAX_BOOST) from open frequency and how recently
 * the file was opened. Pure — the tracker feeds it a `now` so it stays testable.
 */
export function frecencyBoost(entry: FrecencyEntry | undefined, now: number): number {
  if (!entry || entry.count <= 0) return 1;
  const freq = Math.min(1, Math.log2(1 + entry.count) / Math.log2(1 + SATURATION_OPENS));
  const ageDays = Math.max(0, (now - entry.lastOpened) / DAY);
  const rec = Math.exp(-ageDays / OPEN_HALFLIFE_DAYS);
  const signal = 0.6 * freq + 0.4 * rec; // 0 .. 1
  return 1 + MAX_BOOST * signal;
}

/**
 * Tracks how often and how recently each file is opened, persists it beside the
 * index cache, and exposes a ranking boost. Interaction signal the pure index
 * can't carry (it only knows mtime).
 */
export class FrecencyTracker {
  private readonly entries = new Map<string, FrecencyEntry>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly app: App,
    private readonly cacheDir: string | undefined,
  ) {}

  private path(): string | null {
    return this.cacheDir ? `${this.cacheDir}/frecency.json` : null;
  }

  async load(): Promise<void> {
    const path = this.path();
    if (!path) return;
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(path))) return;
      const raw = JSON.parse(await adapter.read(path)) as Record<string, FrecencyEntry>;
      for (const [p, e] of Object.entries(raw)) {
        if (e && typeof e.count === 'number' && typeof e.lastOpened === 'number') {
          this.entries.set(p, e);
        }
      }
    } catch (e) {
      console.warn('Sonar: failed to load frecency', e);
    }
  }

  /** Register the file-open listener that feeds the tracker. */
  start(registerEvent: (ref: EventRef) => void, now: () => number): void {
    registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file) this.record(file.path, now());
      }),
    );
  }

  record(path: string, now: number): void {
    const e = this.entries.get(path);
    if (e) {
      e.count += 1;
      e.lastOpened = now;
    } else {
      this.entries.set(path, { count: 1, lastOpened: now });
    }
    this.scheduleSave();
  }

  boost(path: string, now: number): number {
    return frecencyBoost(this.entries.get(path), now);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  private async save(): Promise<void> {
    const path = this.path();
    if (!path) return;
    try {
      const obj: Record<string, FrecencyEntry> = {};
      for (const [p, e] of this.entries) obj[p] = e;
      await this.app.vault.adapter.write(path, JSON.stringify(obj));
    } catch (e) {
      console.warn('Sonar: failed to save frecency', e);
    }
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.save();
    }
  }
}
