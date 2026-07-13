# Sonar Omni-bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Sonar from a file-retrieval palette into a locate-and-act omni-bar with four modes — search (existing), command, capture, intent — selected by a leading sigil.

**Architecture:** A thin Mode layer sits *above* the modal and is orthogonal to the existing `ProviderRegistry` (which stays a search-only fusion layer). Search mode (`''`) keeps its current registry code path untouched; command (`>`), capture (`+`), and intent (`?`) modes are new classes that each produce `OmniRow[]`, which the modal renders and dispatches. An `ActionCatalog` built from `app.commands` powers command mode and is exposed to Exo (via `getActions`/`runAction`) so intent mode can *execute*, not just chat.

**Tech Stack:** TypeScript (ESM, `.ts` import specifiers), Obsidian API, vitest, esbuild. No new runtime dependencies.

## Global Constraints

- **Language of code & UI copy:** English (product/tech surface).
- **Import specifiers include the `.ts` extension** — e.g. `from './parse.ts'` — matching every existing file.
- **Test command:** `pnpm vitest run <path>`. **Typecheck:** `pnpm typecheck`. **Build:** `pnpm build` (runs typecheck + esbuild).
- **Never use `processFrontMatter`** for capture — it mangles unquoted frontmatter wikilinks. Append raw text only.
- **No decorative surfaces for mode affordance** — pill/divider is border + accent text + row-icon accent only; no filled background, no tab-card.
- **`isDesktopOnly: false`** stays — all modes must work in the mobile bottom-sheet; sigils are typed on the soft keyboard (no new touch UI required in v1).
- **Search mode must stay byte-for-byte behaviorally unchanged** — the `''` sigil path runs the existing `refresh()`/`buildBrowse()` code.
- **Frequent commits** — one per task minimum, at the green step.
- **Build deploys into the vault** via `.obsidian-plugin-dir`; never `cp` the repo's stale `main.js`.

---

### Task 1: Mode types + sigil parsing

**Files:**
- Create: `src/ui/modes/types.ts`
- Create: `src/ui/modes/parse.ts`
- Test: `src/ui/modes/parse.test.ts`

**Interfaces:**
- Produces: `type ModeSigil = '' | '>' | '+' | '?'`; `interface OmniRow { key: string; icon: string; main: string; sub?: string; aux?: string; disabled?: boolean; run(newTab: boolean): void | Promise<void> }`; `interface Mode { sigil: ModeSigil; chipLabel: string; accent: string; placeholder: string; rows(stripped: string): OmniRow[] | Promise<OmniRow[]> }`; `function parseSigil(raw: string): { sigil: ModeSigil; stripped: string }`.

- [ ] **Step 1: Write the failing test**

`src/ui/modes/parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseSigil } from './parse.ts';

describe('parseSigil', () => {
  it('returns search mode for plain text', () => {
    expect(parseSigil('hello world')).toEqual({ sigil: '', stripped: 'hello world' });
  });
  it('detects each sigil and strips it with leading whitespace', () => {
    expect(parseSigil('> annotate')).toEqual({ sigil: '>', stripped: 'annotate' });
    expect(parseSigil('+idea')).toEqual({ sigil: '+', stripped: 'idea' });
    expect(parseSigil('?  riassumi')).toEqual({ sigil: '?', stripped: 'riassumi' });
  });
  it('treats a bare sigil as an empty stripped query', () => {
    expect(parseSigil('>')).toEqual({ sigil: '>', stripped: '' });
  });
  it('does not treat a sigil mid-string as a mode', () => {
    expect(parseSigil('a > b')).toEqual({ sigil: '', stripped: 'a > b' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/modes/parse.test.ts`
Expected: FAIL — cannot find module `./parse.ts`.

- [ ] **Step 3: Write minimal implementation**

`src/ui/modes/types.ts`:
```ts
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
```

`src/ui/modes/parse.ts`:
```ts
import type { ModeSigil } from './types.ts';

const SIGILS: ModeSigil[] = ['>', '+', '?'];

/** Split a raw input into its mode sigil (first char, if one) and the remaining
 *  query with leading whitespace trimmed. Plain text is search mode (''). */
export function parseSigil(raw: string): { sigil: ModeSigil; stripped: string } {
  const first = raw[0] as ModeSigil | undefined;
  if (first && SIGILS.includes(first)) {
    return { sigil: first, stripped: raw.slice(1).replace(/^\s+/, '') };
  }
  return { sigil: '', stripped: raw };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/modes/parse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/modes/types.ts src/ui/modes/parse.ts src/ui/modes/parse.test.ts
git commit -m "feat(modes): mode types + sigil parsing"
```

---

### Task 2: Action catalog

**Files:**
- Create: `src/service/action-catalog.ts`
- Test: `src/service/action-catalog.test.ts`

**Interfaces:**
- Consumes: `subsequenceScore` from `src/index/subseq.ts` (`(query, candidate) => number | null`, higher = better, `null` = no match — same usage as `file-finder-provider`).
- Produces:
  - `interface CommandLike { id: string; name: string }`
  - `interface SonarAction { id: string; title: string; source: string; destructive: boolean; run(): void; describe: string }`
  - `interface SonarActionInfo { id: string; title: string; source: string; destructive: boolean; describe: string }` (serializable subset — no `run`)
  - `class ActionCatalog` with `constructor(load: () => CommandLike[], exec: (id: string) => void, hotkeyOf?: (id: string) => string | undefined)`; methods `all(): SonarAction[]`, `info(): SonarActionInfo[]`, `run(id: string): void`, `match(query: string): SonarAction[]`, `invalidate(): void`.

The catalog is injected with `load`/`exec`/`hotkeyOf` (thin wrappers over `app.commands`) so it is testable without an Obsidian `App`.

- [ ] **Step 1: Write the failing test**

`src/service/action-catalog.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ActionCatalog, type CommandLike } from './action-catalog.ts';

const COMMANDS: CommandLike[] = [
  { id: 'aiditor:annotate-selection', name: 'Annotate selection' },
  { id: 'app:delete-file', name: 'Delete current file' },
  { id: 'editor:toggle-bold', name: 'Toggle bold' },
];

function make(exec = vi.fn()) {
  return new ActionCatalog(() => COMMANDS, exec, (id) => (id === 'editor:toggle-bold' ? '⌘B' : undefined));
}

describe('ActionCatalog', () => {
  it('parses source from the command id prefix', () => {
    const a = make().all();
    expect(a.find((x) => x.id === 'aiditor:annotate-selection')?.source).toBe('aiditor');
    expect(a.find((x) => x.id === 'app:delete-file')?.source).toBe('app');
  });

  it('flags destructive commands by name/id heuristic', () => {
    const a = make().all();
    expect(a.find((x) => x.id === 'app:delete-file')?.destructive).toBe(true);
    expect(a.find((x) => x.id === 'editor:toggle-bold')?.destructive).toBe(false);
  });

  it('match() returns only subsequence-matching actions', () => {
    const ids = make().match('annsel').map((a) => a.id);
    expect(ids).toContain('aiditor:annotate-selection');
    expect(ids).not.toContain('editor:toggle-bold');
  });

  it('run() executes the command by id', () => {
    const exec = vi.fn();
    make(exec).run('editor:toggle-bold');
    expect(exec).toHaveBeenCalledWith('editor:toggle-bold');
  });

  it('info() omits the run closure', () => {
    const info = make().info()[0];
    expect(info).not.toHaveProperty('run');
    expect(info).toHaveProperty('title');
  });

  it('caches all() until invalidate()', () => {
    const load = vi.fn(() => COMMANDS);
    const cat = new ActionCatalog(load, vi.fn());
    cat.all();
    cat.all();
    expect(load).toHaveBeenCalledTimes(1);
    cat.invalidate();
    cat.all();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/service/action-catalog.test.ts`
Expected: FAIL — cannot find module `./action-catalog.ts`.

- [ ] **Step 3: Write minimal implementation**

`src/service/action-catalog.ts`:
```ts
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
    return this.all().map(({ run: _run, ...rest }) => rest);
  }

  run(id: string): void {
    this.exec(id);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/service/action-catalog.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/action-catalog.ts src/service/action-catalog.test.ts
git commit -m "feat(actions): action catalog from host commands"
```

---

### Task 3: Frecency for actions

**Files:**
- Modify: `src/service/frecency.ts`
- Test: `src/service/frecency.test.ts` (append)

**Interfaces:**
- Consumes: existing `FrecencyTracker.record(path, now)` / `boost(path, now)` and the pure `frecencyBoost`.
- Produces: `FrecencyTracker.bumpAction(id: string, now: number): void` and `FrecencyTracker.actionBoost(id: string, now: number): number`, keyed under a `cmd:` namespace in the same persisted map (no format change).

- [ ] **Step 1: Write the failing test**

Append to `src/service/frecency.test.ts`:
```ts
import { FrecencyTracker } from './frecency.ts';

describe('FrecencyTracker action frecency', () => {
  const app = { vault: { adapter: {} } } as never;
  it('bumpAction raises actionBoost above the neutral 1', () => {
    const t = new FrecencyTracker(app, undefined);
    const now = 100 * 86_400_000;
    expect(t.actionBoost('editor:toggle-bold', now)).toBe(1);
    for (let i = 0; i < 10; i++) t.bumpAction('editor:toggle-bold', now);
    expect(t.actionBoost('editor:toggle-bold', now)).toBeGreaterThan(1);
  });
  it('keeps action and file namespaces separate', () => {
    const t = new FrecencyTracker(app, undefined);
    const now = 100 * 86_400_000;
    t.bumpAction('foo', now);
    expect(t.boost('foo', now)).toBe(1); // file 'foo' untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/service/frecency.test.ts`
Expected: FAIL — `bumpAction`/`actionBoost` are not functions.

- [ ] **Step 3: Write minimal implementation**

In `src/service/frecency.ts`, add inside `class FrecencyTracker` (after `boost`):
```ts
  /** Frecency for a runnable action, namespaced so it can't collide with a
   *  file path. Reuses the same map + persistence as file opens. */
  bumpAction(id: string, now: number): void {
    this.record(`cmd:${id}`, now);
  }

  actionBoost(id: string, now: number): number {
    return this.boost(`cmd:${id}`, now);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/service/frecency.test.ts`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/service/frecency.ts src/service/frecency.test.ts
git commit -m "feat(frecency): namespaced action frecency"
```

---

### Task 4: Command mode

**Files:**
- Create: `src/ui/modes/command-mode.ts`
- Test: `src/ui/modes/command-mode.test.ts`

**Interfaces:**
- Consumes: `Mode`/`OmniRow` from `./types.ts`; `ActionCatalog`, `SonarAction` from `../../service/action-catalog.ts`; `FrecencyTracker` from `../../service/frecency.ts`.
- Produces: `class CommandMode implements Mode` — `constructor(catalog: ActionCatalog, frecency: Pick<FrecencyTracker, 'actionBoost' | 'bumpAction'>, now: () => number, onRun: () => void)`. `sigil='>'`, `chipLabel='Command'`, `accent='--sonar-accent-cmd'`. `rows(stripped)` returns matched actions as `OmniRow`s, re-ranked by `subseq-rank × actionBoost`, whose `run()` bumps frecency, runs the action, then calls `onRun` (the modal's close).

- [ ] **Step 1: Write the failing test**

`src/ui/modes/command-mode.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { CommandMode } from './command-mode.ts';
import { ActionCatalog, type CommandLike } from '../../service/action-catalog.ts';

const CMDS: CommandLike[] = [
  { id: 'a:save', name: 'Save' },
  { id: 'b:save', name: 'Save' },
  { id: 'x:toggle-bold', name: 'Toggle bold' },
];

function build(boosts: Record<string, number> = {}) {
  const exec = vi.fn();
  const catalog = new ActionCatalog(() => CMDS, exec);
  const frecency = {
    actionBoost: (id: string) => boosts[id] ?? 1,
    bumpAction: vi.fn(),
  };
  const onRun = vi.fn();
  return { mode: new CommandMode(catalog, frecency, () => 0, onRun), exec, frecency, onRun };
}

describe('CommandMode', () => {
  it('maps a matching action to an OmniRow', async () => {
    const { mode } = build();
    const rows = await mode.rows('bold');
    expect(rows[0].main).toBe('Toggle bold');
    expect(rows[0].key).toBe('x:toggle-bold');
  });

  it('breaks equal-score ties by action frecency', async () => {
    const { mode } = build({ 'b:save': 5 }); // both "Save" score equally on "save"
    const rows = await mode.rows('save');
    expect(rows.map((r) => r.key).slice(0, 2)).toEqual(['b:save', 'a:save']);
  });

  it('run() bumps frecency, executes, then closes', async () => {
    const { mode, exec, frecency, onRun } = build();
    const rows = await mode.rows('bold');
    await rows[0].run(false);
    expect(frecency.bumpAction).toHaveBeenCalledWith('x:toggle-bold', 0);
    expect(exec).toHaveBeenCalledWith('x:toggle-bold');
    expect(onRun).toHaveBeenCalled();
  });

  it('shows a disabled hint when there are no matches', async () => {
    const { mode } = build();
    const rows = await mode.rows('zzzzz');
    expect(rows).toHaveLength(1);
    expect(rows[0].disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/modes/command-mode.test.ts`
Expected: FAIL — cannot find module `./command-mode.ts`.

- [ ] **Step 3: Write minimal implementation**

`src/ui/modes/command-mode.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/modes/command-mode.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/modes/command-mode.ts src/ui/modes/command-mode.test.ts
git commit -m "feat(modes): command mode"
```

---

### Task 5: Capture service (pure helpers + IO)

**Files:**
- Create: `src/service/capture.ts`
- Test: `src/service/capture.test.ts`

**Interfaces:**
- Produces:
  - `function dailyBasename(now: number): string` → `DD-MM-YYYY` (vault daily convention).
  - `function isTaskLine(text: string): boolean` → true for `[ ]` / `- [ ]` prefixes.
  - `function formatCaptureLine(text: string, now: number): string` → `- [ ] <body> 📅 YYYY-MM-DD` for tasks, else `- <text>`.
  - `function appendToCaptureSection(content: string, line: string): string` → returns `content` with `line` appended under a `## 🌱 Capture` heading, creating the heading (and a leading blank line) when absent. Pure — no IO.
  - `async function appendCapture(app: App, text: string, now: number): Promise<void>` → thin IO: resolve today's daily path, read-or-create, apply `appendToCaptureSection`, write. Manually tested (no unit test).

- [ ] **Step 1: Write the failing test**

`src/service/capture.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { dailyBasename, isTaskLine, formatCaptureLine, appendToCaptureSection } from './capture.ts';

const NOW = Date.UTC(2026, 6, 13, 10, 0); // 2026-07-13

describe('capture helpers', () => {
  it('formats the daily basename as DD-MM-YYYY', () => {
    expect(dailyBasename(NOW)).toBe('13-07-2026');
  });

  it('detects task lines', () => {
    expect(isTaskLine('[ ] buy milk')).toBe(true);
    expect(isTaskLine('- [ ] buy milk')).toBe(true);
    expect(isTaskLine('just a thought')).toBe(false);
  });

  it('formats a task line with a due date and strips the checkbox prefix', () => {
    expect(formatCaptureLine('[ ] buy milk', NOW)).toBe('- [ ] buy milk 📅 2026-07-13');
  });

  it('formats a plain capture as a bullet', () => {
    expect(formatCaptureLine('a thought', NOW)).toBe('- a thought');
  });

  it('creates the Capture section when absent', () => {
    const out = appendToCaptureSection('# Daily\n\nsome notes\n', '- hi');
    expect(out).toBe('# Daily\n\nsome notes\n\n## 🌱 Capture\n- hi\n');
  });

  it('appends under an existing Capture section without duplicating it', () => {
    const src = '# Daily\n\n## 🌱 Capture\n- first\n';
    const out = appendToCaptureSection(src, '- second');
    expect(out).toBe('# Daily\n\n## 🌱 Capture\n- first\n- second\n');
    expect(out.match(/## 🌱 Capture/g)).toHaveLength(1);
  });

  it('preserves unquoted frontmatter wikilinks untouched', () => {
    const src = '---\ncompany: [[Captoo]]\n---\n\n## 🌱 Capture\n- a\n';
    const out = appendToCaptureSection(src, '- b');
    expect(out).toContain('company: [[Captoo]]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/service/capture.test.ts`
Expected: FAIL — cannot find module `./capture.ts`.

- [ ] **Step 3: Write minimal implementation**

`src/service/capture.ts`:
```ts
import { normalizePath, TFile, type App } from 'obsidian';

const CAPTURE_HEADING = '## 🌱 Capture';
const DAILY_DIR = 'Journal/Daily';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Vault daily-note basename: DD-MM-YYYY. */
export function dailyBasename(now: number): string {
  const d = new Date(now);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function isoDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isTaskLine(text: string): boolean {
  return /^\s*(-\s*)?\[\s?\]/.test(text);
}

/** A capture line: tasks become checkboxes with a due date; everything else a bullet. */
export function formatCaptureLine(text: string, now: number): string {
  if (isTaskLine(text)) {
    const body = text.replace(/^\s*(-\s*)?\[\s?\]\s*/, '').trim();
    return `- [ ] ${body} 📅 ${isoDate(now)}`;
  }
  return `- ${text.trim()}`;
}

/** Append `line` under the `## 🌱 Capture` heading, creating it if absent.
 *  Pure string transform — never parses or rewrites frontmatter. */
export function appendToCaptureSection(content: string, line: string): string {
  const idx = content.indexOf(CAPTURE_HEADING);
  if (idx === -1) {
    const base = content.endsWith('\n') ? content : `${content}\n`;
    return `${base}\n${CAPTURE_HEADING}\n${line}\n`;
  }
  // Find the end of the heading line, then the end of that section's existing
  // lines (up to the next heading or EOF), and insert before it.
  const afterHeading = content.indexOf('\n', idx) + 1;
  const nextHeading = content.indexOf('\n#', afterHeading);
  const sectionEnd = nextHeading === -1 ? content.length : nextHeading + 1;
  const head = content.slice(0, sectionEnd).replace(/\n*$/, '\n');
  const tail = content.slice(sectionEnd);
  return `${head}${line}\n${tail}`.replace(/\n{3,}/g, '\n\n');
}

/** Resolve today's daily note (creating it if needed) and append a capture line
 *  as RAW TEXT. Never uses processFrontMatter. */
export async function appendCapture(app: App, text: string, now: number): Promise<void> {
  const path = normalizePath(`${DAILY_DIR}/${dailyBasename(now)}.md`);
  const line = formatCaptureLine(text, now);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.process(existing, (c) => appendToCaptureSection(c, line));
    return;
  }
  await app.vault.create(path, `${CAPTURE_HEADING}\n${line}\n`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/service/capture.test.ts`
Expected: PASS (7 tests). If the `appendToCaptureSection` whitespace assertions fail on an edge, adjust the normalization in that pure function only — do not touch the IO path.

- [ ] **Step 5: Commit**

```bash
git add src/service/capture.ts src/service/capture.test.ts
git commit -m "feat(capture): daily capture helpers + raw-text append"
```

---

### Task 6: Capture mode

**Files:**
- Create: `src/ui/modes/capture-mode.ts`
- Test: `src/ui/modes/capture-mode.test.ts`

**Interfaces:**
- Consumes: `Mode`/`OmniRow` from `./types.ts`; `isTaskLine` from `../../service/capture.ts`.
- Produces: `class CaptureMode implements Mode` — `constructor(commit: (text: string) => Promise<void>, now: () => number, onDone: () => void)`. `sigil='+'`, `chipLabel='Capture'`, `accent='--sonar-accent-cap'`. `rows(stripped)` returns a single preview `OmniRow` (disabled when empty) whose `run()` commits then closes. The `commit` closure is wired to `appendCapture(app, text, now)` in the modal, keeping this class App-free and testable.

- [ ] **Step 1: Write the failing test**

`src/ui/modes/capture-mode.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { CaptureMode } from './capture-mode.ts';

function build() {
  const commit = vi.fn(async () => {});
  const onDone = vi.fn();
  return { mode: new CaptureMode(commit, () => 0, onDone), commit, onDone };
}

describe('CaptureMode', () => {
  it('is disabled with an empty query', async () => {
    const rows = await build().mode.rows('   ');
    expect(rows[0].disabled).toBe(true);
  });

  it('previews a bullet capture target', async () => {
    const rows = await build().mode.rows('an idea');
    expect(rows[0].main).toBe('an idea');
    expect(rows[0].sub).toContain('🌱 Capture');
    expect(rows[0].disabled).toBeFalsy();
  });

  it('previews a task target when the line is a checkbox', async () => {
    const rows = await build().mode.rows('[ ] do the thing');
    expect(rows[0].sub).toContain('Task');
  });

  it('run() commits the text then finishes', async () => {
    const { mode, commit, onDone } = build();
    const rows = await mode.rows('note this');
    await rows[0].run(false);
    expect(commit).toHaveBeenCalledWith('note this');
    expect(onDone).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/modes/capture-mode.test.ts`
Expected: FAIL — cannot find module `./capture-mode.ts`.

- [ ] **Step 3: Write minimal implementation**

`src/ui/modes/capture-mode.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/modes/capture-mode.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/modes/capture-mode.ts src/ui/modes/capture-mode.test.ts
git commit -m "feat(modes): capture mode"
```

---

### Task 7: Intent mode

**Files:**
- Create: `src/ui/modes/intent-mode.ts`
- Test: `src/ui/modes/intent-mode.test.ts`

**Interfaces:**
- Consumes: `Mode`/`OmniRow` from `./types.ts`.
- Produces: `class IntentMode implements Mode` — `constructor(isAvailable: () => boolean, ask: (text: string) => void)`. `sigil='?'`, `chipLabel='Ask Exo'`, `accent='--sonar-accent-int'`. `rows(stripped)` returns a single preview `OmniRow`: disabled when the query is empty or when `isAvailable()` is false (sub becomes "Exo not available"); `run()` calls `ask(stripped)`.

- [ ] **Step 1: Write the failing test**

`src/ui/modes/intent-mode.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { IntentMode } from './intent-mode.ts';

describe('IntentMode', () => {
  it('is disabled when Exo is unavailable', async () => {
    const rows = await new IntentMode(() => false, vi.fn()).rows('do it');
    expect(rows[0].disabled).toBe(true);
    expect(rows[0].sub).toContain('not available');
  });

  it('is disabled with an empty query', async () => {
    const rows = await new IntentMode(() => true, vi.fn()).rows('  ');
    expect(rows[0].disabled).toBe(true);
  });

  it('previews and runs the intent', async () => {
    const ask = vi.fn();
    const rows = await new IntentMode(() => true, ask).rows('riassumi la nota');
    expect(rows[0].main).toBe('riassumi la nota');
    expect(rows[0].aux).toBe('→ Exo');
    await rows[0].run(false);
    expect(ask).toHaveBeenCalledWith('riassumi la nota');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/modes/intent-mode.test.ts`
Expected: FAIL — cannot find module `./intent-mode.ts`.

- [ ] **Step 3: Write minimal implementation**

`src/ui/modes/intent-mode.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/modes/intent-mode.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/modes/intent-mode.ts src/ui/modes/intent-mode.test.ts
git commit -m "feat(modes): intent mode"
```

---

### Task 8: Modal integration

**Files:**
- Modify: `src/ui/modal.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `parseSigil` from `./modes/parse.ts`; `Mode`/`OmniRow` from `./modes/types.ts`; the three mode classes. Modes are constructed here from `deps` (added in Task 9).
- Produces: an omni-capable modal. `ModalDeps` gains `modes: () => Mode[]` (a factory returning fresh mode instances bound to `this.close`, `this.askExo`, and capture commit). Search behavior for sigil `''` is unchanged.

This task has no unit test (the modal has no test file — repo convention); it is verified by typecheck, build, and manual walkthrough.

- [ ] **Step 1: Extend `ModalDeps`, `RowItem`, and mode state**

In `src/ui/modal.ts`:

Add imports near the top (after existing imports):
```ts
import { parseSigil } from './modes/parse.ts';
import type { Mode, OmniRow } from './modes/types.ts';
```

Extend `ModalDeps`:
```ts
export interface ModalDeps {
  registry: ProviderRegistry;
  service: SearchService;
  fileCatalog: FileCatalog;
  settings: SonarSettings;
  now: () => number;
  /** Fresh mode instances for this modal session; wiring in main.ts. The
   *  factory receives the modal's close + askExo callbacks. */
  modes: (ctx: { close: () => void; askExo: (q: string) => void }) => Mode[];
}
```

Extend `RowItem` (add one optional field):
```ts
  omni?: OmniRow;
```

Add instance fields near `private raw = ''` (search the file for the existing `raw` declaration and add beside it):
```ts
  private modeList: Mode[] = [];
  private mode: Mode | null = null; // null = search
  private stripped = '';
  private modeChipEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
```

- [ ] **Step 2: Build the mode list + chip + hint in `onOpen`**

In `onOpen()`, after `this.inputEl = ...` is created and before `this.refresh()`, add the mode list and the pill holder. Insert the chip element as the first child of `inputRow` (before the search icon) so it sits left of the input:

```ts
    this.modeList = this.deps.modes({ close: () => this.close(), askExo: (q) => this.askExo(q) });
    this.modeChipEl = inputRow.createDiv({ cls: 'sonar-mode-chip' });
    this.modeChipEl.hide();
```

After the footer is created, add the grammar hint (hidden unless browsing):
```ts
    this.hintEl = this.contentEl.createDiv({ cls: 'sonar-mode-hint' });
    this.hintEl.setText('>  commands   ·   +  capture   ·   ?  ask Exo');
```

- [ ] **Step 3: Route input through the mode parser**

Replace `onInput`:
```ts
  private onInput(value: string): void {
    this.raw = value;
    this.clearBtn.toggleClass('is-visible', value.length > 0);
    const { sigil, stripped } = parseSigil(value);
    const next = sigil === '' ? null : this.modeList.find((m) => m.sigil === sigil) ?? null;
    this.stripped = stripped;
    if (next !== this.mode) {
      this.mode = next;
      this.applyModeChrome();
    }
    this.refresh();
  }
```

Add the chrome helper:
```ts
  /** Show/hide the mode pill + swap the input placeholder for the active mode. */
  private applyModeChrome(): void {
    const chip = this.modeChipEl;
    if (!chip) return;
    if (!this.mode) {
      chip.hide();
      chip.removeAttribute('data-accent');
      this.inputEl.placeholder = 'Search your vault…';
      return;
    }
    chip.empty();
    chip.show();
    chip.setAttribute('data-accent', this.mode.accent);
    chip.createSpan({ cls: 'sonar-mode-chip__label', text: this.mode.chipLabel });
    this.inputEl.placeholder = this.mode.placeholder;
  }
```

- [ ] **Step 4: Branch `refresh` on the active mode**

At the very top of `refresh()`, before the existing body, add:
```ts
    if (this.mode) {
      this.cancelQuery?.();
      const active = this.mode;
      void Promise.resolve(active.rows(this.stripped)).then((rows) => {
        if (this.mode !== active) return; // mode changed while awaiting
        this.groups = [{ items: rows.map((o) => this.omniItem(o)) }];
        this.commitRows();
      });
      return;
    }
```

Add the adapter that wraps an `OmniRow` in a `RowItem`:
```ts
  private omniItem(o: OmniRow): RowItem {
    return { path: '', basename: o.main, docType: 'md', matched: [], omni: o };
  }
```

Toggle the hint in `buildBrowse()` — at its start add `this.hintEl?.show();`, and in the typed-search `refresh` path (and the mode branch) add `this.hintEl?.hide();` at their tops. Simplest: set `this.hintEl?.toggle(!this.mode && !this.raw.trim())` as the first line of `refresh()`.

- [ ] **Step 5: Render and activate omni rows**

In `renderList()`, add a branch inside the `for (const item of group.items)` loop, before the `renderResultRow(...)` call (alongside the `item.create` / `item.exo` branches):
```ts
        if (item.omni) {
          const o = item.omni;
          const row = holder.createDiv({ cls: 'sonar-result sonar-result--omni' });
          if (o.disabled) row.addClass('is-disabled');
          if (i === this.selected) row.addClass('is-selected');
          const thumb = row.createDiv({ cls: 'sonar-result__thumb' });
          if (this.mode) thumb.setAttribute('data-accent', this.mode.accent);
          setIcon(thumb.createDiv({ cls: 'sonar-thumb__icon' }), o.icon);
          const main = row.createDiv({ cls: 'sonar-result__main' });
          main.createDiv({ cls: 'sonar-result__title', text: o.main });
          if (o.sub) main.createDiv({ cls: 'sonar-result__sub', text: o.sub });
          if (o.aux) row.createDiv({ cls: 'sonar-result__aux', text: o.aux });
          if (!o.disabled) row.addEventListener('click', () => this.activate(i, false));
          continue;
        }
```

In `renderPreview()`, extend the early-return guard so omni rows show no preview:
```ts
    if (!item || item.create || item.exo || item.omni) {
```

In `activate()`, add a branch before `this.openPath(...)`:
```ts
    if (item.omni) {
      if (!item.omni.disabled) void item.omni.run(newTab);
      return;
    }
```

- [ ] **Step 6: Style the pill, hint, and omni row**

First grep to match Sonar's existing tokens: `rg "sonar-result__|sonar-input-row|--sonar" styles.css | head`.

Append to `styles.css`:
```css
/* Omni-bar mode affordance — geometry + accent only, no filled surface. */
.sonar-mode-chip {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  margin-right: 4px;
  border-right: 1px solid var(--background-modifier-border);
  color: var(--text-accent);
  font-weight: 600;
  font-size: var(--font-ui-small);
  white-space: nowrap;
}
.sonar-mode-chip[data-accent='--sonar-accent-cmd'] { color: var(--color-blue); }
.sonar-mode-chip[data-accent='--sonar-accent-cap'] { color: var(--color-green); }
.sonar-mode-chip[data-accent='--sonar-accent-int'] { color: var(--color-purple); }

.sonar-mode-hint {
  padding: 6px 12px;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  border-top: 1px solid var(--background-modifier-border);
}

.sonar-result--omni .sonar-result__aux {
  margin-left: auto;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.sonar-result--omni.is-disabled { opacity: 0.55; cursor: default; }
.sonar-result--omni .sonar-thumb__icon[data-accent='--sonar-accent-cmd'] { color: var(--color-blue); }
.sonar-result--omni .sonar-result__thumb[data-accent='--sonar-accent-cap'] .sonar-thumb__icon { color: var(--color-green); }
.sonar-result--omni .sonar-result__thumb[data-accent='--sonar-accent-int'] .sonar-thumb__icon { color: var(--color-purple); }
```
(Adjust selectors to the real class names surfaced by the grep; the accent goes on the `.sonar-result__thumb` wrapper per Step 5.)

- [ ] **Step 7: Typecheck + build**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm build`
Expected: build succeeds and writes `main.js` into the vault plugin dir.

- [ ] **Step 8: Manual verification**

Reload Sonar in Obsidian (do NOT copy the repo `main.js`; the build already deployed it). Then:
- Open Sonar, type nothing → browse view shows, grammar hint visible at the bottom.
- Type `>` → pill "Command" appears, placeholder changes, commands list; type `> bold` → Toggle bold ranks; Enter runs it and closes.
- Type `+ test capture` → preview row "→ Daily · 🌱 Capture"; Enter appends to today's daily under `## 🌱 Capture` and closes; verify the daily note.
- Type `+ [ ] a task` → preview "→ Task"; Enter writes `- [ ] a task 📅 <today>`.
- Type `? riassumi` → if Exo installed, preview "→ Exo"; Enter launches an Exo chat; if not installed, row is disabled "Exo not available".
- Backspace to empty → returns to search, pill gone.
- Repeat on a narrow window / phone (bottom-sheet): all modes usable, sheet still drag-to-dismiss.

- [ ] **Step 9: Commit**

```bash
git add src/ui/modal.ts styles.css
git commit -m "feat(modal): omni-bar mode integration (command/capture/intent)"
```

---

### Task 9: Wire modes + expose the cross-plugin action API

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `ActionCatalog`, mode classes, `appendCapture`, `FrecencyTracker`.
- Produces: the `modes` factory passed to `openModal()`; public plugin methods `getActions(): SonarActionInfo[]` and `runAction(id: string): Promise<{ ok: boolean; destructive: boolean }>` for the Exo tool-surface.

- [ ] **Step 1: Construct the catalog and wire the modes factory**

In `src/main.ts`, add imports:
```ts
import { ActionCatalog, type SonarActionInfo } from './service/action-catalog.ts';
import { CommandMode } from './ui/modes/command-mode.ts';
import { CaptureMode } from './ui/modes/capture-mode.ts';
import { IntentMode } from './ui/modes/intent-mode.ts';
import { appendCapture } from './service/capture.ts';
```

Add a field and build the catalog in `onload()` (after the registry wiring):
```ts
  private catalog!: ActionCatalog;
```
```ts
    this.catalog = new ActionCatalog(
      () => this.app.commands.listCommands().map((c) => ({ id: c.id, name: c.name })),
      (id) => { this.app.commands.executeCommandById(id); },
      (id) => this.hotkeyLabel(id),
    );
    // Command availability changes when plugins toggle; drop the cache then.
    this.registerEvent(this.app.workspace.on('layout-change', () => this.catalog.invalidate()));
```

`app.commands` / `hotkeyManager` aren't in the public typings; add a local cast helper:
```ts
  private hotkeyLabel(id: string): string | undefined {
    const hk = (this.app as unknown as {
      hotkeyManager?: { getHotkeys?: (id: string) => Array<{ modifiers: string[]; key: string }> };
    }).hotkeyManager?.getHotkeys?.(id)?.[0];
    if (!hk) return undefined;
    return [...hk.modifiers, hk.key].join('+');
  }
```
(If `app.commands` also lacks typings, cast it the same way at the call site: `(this.app as unknown as { commands: { listCommands(): Array<{ id: string; name: string }>; executeCommandById(id: string): void } }).commands`.)

- [ ] **Step 2: Pass the modes factory into `openModal`**

In `openModal()`, add `modes` to the `ModalDeps` object:
```ts
      modes: ({ close, askExo }) => [
        new CommandMode(this.catalog, this.frecency, () => Date.now(), close),
        new CaptureMode((text) => appendCapture(this.app, text, Date.now()), () => Date.now(), close),
        new IntentMode(() => this.exoAvailable(), (q) => askExo(q)),
      ],
```

Add the Exo-availability check on the plugin (mirrors the modal's `exoPlugin()`):
```ts
  private exoAvailable(): boolean {
    const p = (this.app as unknown as { plugins?: { plugins?: Record<string, { askExo?: unknown }> } })
      .plugins?.plugins?.['exo'];
    return typeof p?.askExo === 'function';
  }
```

- [ ] **Step 3: Expose the action API for Exo**

Add two public methods on the plugin class:
```ts
  /** Read-only action catalog for cross-plugin consumers (Exo's tool-surface). */
  getActions(): SonarActionInfo[] {
    return this.catalog.info();
  }

  /** Execute an action by id. Destructive actions are flagged so the caller can
   *  gate them behind a confirmation. */
  async runAction(id: string): Promise<{ ok: boolean; destructive: boolean }> {
    const action = this.catalog.all().find((a) => a.id === id);
    if (!action) return { ok: false, destructive: false };
    action.run();
    return { ok: true, destructive: action.destructive };
  }
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm build`
Expected: succeeds, deploys `main.js`.

- [ ] **Step 5: Manual verification**

Reload Sonar. In the Obsidian dev console:
```js
app.plugins.plugins.sonar.getActions().length        // > 0
app.plugins.plugins.sonar.getActions().find(a => a.destructive)  // some delete/trash action
await app.plugins.plugins.sonar.runAction('editor:toggle-bold')  // { ok: true, destructive: false }
```

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): wire modes + expose getActions/runAction for Exo"
```

---

### Task 10: Reposition the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the intro + Usage**

Change the top-of-file framing from "search engine" to omni-bar. Replace the first paragraph under `# Sonar` with:
```markdown
A fast, relevance-first **omni-bar** for Obsidian. One ping and the right thing
surfaces — open a note, run a command, capture a thought, or hand an intent to
Exo. Search is still the core (a from-scratch BM25F engine that ranks better
than Omnisearch, with a drop-in HTTP API); it's now one of four modes.
```

Add a `## Modes` section after `## Features`:
```markdown
## Modes

Type a leading sigil to switch mode; backspace on an empty input returns to search.

| Input        | Mode    | Does                                                      |
|--------------|---------|----------------------------------------------------------|
| `hello`      | Search  | BM25F search across the vault (the default).             |
| `> annotate` | Command | Run any Obsidian or suite-plugin command, frecency-ranked.|
| `+ an idea`  | Capture | Append raw text to today's daily under `## 🌱 Capture`. `[ ]` → a dated task. |
| `? summarise`| Intent  | Hand the request to Exo, which executes it via Sonar's action tools. |
```

- [ ] **Step 2: Verify + commit**

Run: `rg -n "search engine" README.md` — expect no stale "just a search engine" framing left in the intro.
```bash
git add README.md
git commit -m "docs: reposition README as omni-bar"
```

---

## Companion work (separate, out of this repo)

The **intent = execution** path needs a change in the `exo` repo: add two Exo
tools, `list_sonar_actions` (calls `sonar.getActions()`) and `run_sonar_action`
(calls `sonar.runAction(id)`, and — per the spec's safety decision — surfaces a
confirmation step when the returned `destructive` flag is true). This mirrors
aiditor's `list_annotations`/`resolve_annotation`. Track it as its own
brainstorm → plan cycle in the `exo` repo; this Sonar plan delivers the API it
consumes but does not build the tools.

## Self-Review

- **Spec coverage:** name kept + README (T10); Mode layer above registry (T1, T8); sigils + hint (T1, T8); command catalog from `app.commands` + suite-free (T2, T9); frecency on actions (T3, T4); capture raw-text under `## 🌱 Capture` + task detection + no processFrontMatter (T5, T6); intent → askExo + execution API (T7, T9); pill+accent, neutral surface, no tab-card (T8 Step 6); cross-plugin `getActions`/`runAction` (T9); destructive gate flagged in `runAction` + deferred to Exo companion (T9, Companion). Out-of-scope items (registerActions, mobile segments, rapid-fire capture, index format) are simply not built — correct.
- **Placeholder scan:** none — every step carries real code and exact commands.
- **Type consistency:** `OmniRow`/`Mode` (T1) consumed unchanged in T4/T6/T7/T8; `ActionCatalog` methods (`all`/`info`/`match`/`run`/`hotkey`/`invalidate`) defined in T2 and used identically in T4/T9; `SonarActionInfo` from T2 used in T9; `bumpAction`/`actionBoost` defined in T3 and consumed in T4; `appendCapture` from T5 used in T9; `modes` factory shape on `ModalDeps` (T8) matches the call in T9.
