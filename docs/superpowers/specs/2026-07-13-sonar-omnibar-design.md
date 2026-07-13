# Sonar → Omni-bar (modes: search · command · capture · intent)

Date: 2026-07-13
Status: draft

## Problem

Sonar is already a fast, centered ⌘K palette with a provider-fusion search
engine, a mobile bottom-sheet, frecency ranking, and synthetic action rows
("Create note", "Search with Exo"). But it does exactly one thing: **retrieve
files**. To act you leave it — the native command palette for commands, the
daily note for capture, an Exo chat for intent.

The goal is to turn Sonar from a *retrieval* surface into a *locate-and-act*
surface — an omni-bar — without breaking its search identity or its drop-in
Omnisearch HTTP API. One ping, and the right thing surfaces: open it, run it,
or hand it to Exo to do.

Four jobs, one surface: **search** (today), **command** (run Obsidian +
suite actions), **capture** (quick text → daily), **intent** (natural language
→ Exo *executes*).

## Decisions

- **Sonar keeps its name and repo.** README repositions from "search engine"
  to omni-bar. The BM25F engine + HTTP API + frecency become the **search
  mode** — one mode of four, not deprecated. The Omnisearch-shaped `/search`
  API is unchanged (search stays a mode).
- **Modes are a layer *above* the modal, orthogonal to `ProviderRegistry`.**
  The registry stays a search-only fusion layer returning `ProviderResult[]`.
  A new `Mode` abstraction owns non-search behavior. Search mode delegates to
  the existing registry unchanged; command/capture/intent modes each own their
  rows and their activation.
- **Activation by leading sigil**, backspace-on-empty returns to search:
  - `` (none) → **Search** — current behavior, untouched.
  - `>` → **Command** — fuzzy over the action catalog.
  - `+` → **Capture** — the rest of the line is the payload.
  - `?` → **Intent** — the rest of the line goes to Exo, which *executes*.
- **Intent = execution, not just chat.** Sonar exposes its action catalog as a
  JS API (`getActions`/`runAction`); Exo consumes it as two tools
  (`list_sonar_actions` / `run_sonar_action`) and executes within its normal,
  visible, interruptible turn. IntentMode launches `askExo(text, true)`. The
  Exo-side tool addition is a companion change in the `exo` repo (dependency,
  not in this repo's scope) — this precedent already exists for aiditor
  (`getAnnotations`/`resolveAnnotation` → `list_annotations`/`resolve_annotation`).
- **Command catalog comes for free from `app.commands.listCommands()`.** Every
  suite plugin already registers Obsidian commands (`aiditor:annotate-selection`,
  exo's ask command, etc.), so command mode surfaces them cross-plugin with zero
  coordination. A `registerActions()` extension point exists for richer, argued
  actions, but is **not required for v1**.
- **Capture target = today's daily note under `## 🌱 Capture`**, raw-text
  append (never `processFrontMatter` — it mangles unquoted frontmatter
  wikilinks). A line starting `[ ]` / `- [ ]` is written as a task with a
  `📅 YYYY-MM-DD` due date. **Enter commits and closes** (consistent with
  search/command; no rapid-fire mode).
- **Mode affordance = pill + minimal accent, neutral surface.** A pill/divider
  left of the input carries the mode label + a per-mode accent; the row icon
  carries the same accent. No full-bar tint, **no decorative tab-card
  background** (honors the "no visible tabbar card" rule — geometry + active
  state only). Discoverability lives in the empty-state grammar hint.
- **Destructive intent actions confirm.** `run_sonar_action` marks actions
  derived from destructive commands (delete/trash/overwrite heuristics) as
  requiring confirmation; Exo must surface a confirm step before invoking them.
  Non-destructive actions execute directly. (Default; open for review.)

## Architecture

### The Mode layer — `src/ui/modes.ts` (new)

The load-bearing addition. A `Mode` is what the modal talks to when the query
carries a sigil. Search is modeled as the identity mode that wraps the registry.

```ts
export type ModeSigil = '' | '>' | '+' | '?';

export interface OmniRow {
  /** Stable key for selection/frecency. For files, the path; for commands,
   *  the command id; for capture/intent, a synthetic key. */
  key: string;
  title: string;
  subtitle?: string;
  /** lucide icon id; the modal applies the per-mode accent. */
  icon?: string;
  /** Right-aligned hint (e.g. a command hotkey, "→ Exo"). */
  aux?: string;
  /** Run on Enter. `newTab` is forwarded for modes that care (search). */
  activate(newTab: boolean): void | Promise<void>;
}

export interface Mode {
  sigil: ModeSigil;
  chipLabel: string;      // '' for search (no pill)
  accent?: string;        // CSS var name for the per-mode accent
  placeholder: string;
  /** Produce rows for the query with the sigil already stripped. Command mode
   *  is synchronous-ish; capture/intent return a single preview row. */
  rows(stripped: string, ctx: ModeContext): Promise<OmniRow[]>;
}

export interface ModeContext {
  app: App;
  deps: ModalDeps;
  now: number;
  /** Close the modal (used by activate paths). */
  close(): void;
}
```

`parseSigil(raw): { mode: Mode; stripped: string }` maps the first char to a
mode (default search, empty pill). Lives here, unit-tested in isolation.

Search mode is **not** rewritten to this contract — it keeps calling the
registry through the modal's existing `refresh()`/`buildBrowse()` path. The
mode layer only kicks in for `>` / `+` / `?`. Rationale: search has rich
existing behavior (chips, fusion, browse grouping, type filters) that would be
a large, risky rewrite to funnel through `OmniRow`; the other three modes are
new and small. `Mode` for search is a thin descriptor (sigil `''`, empty
`chipLabel`) whose `rows()` is never called — the modal branches on
`mode.sigil === ''` and runs its current code.

### Command mode — `src/ui/modes/command-mode.ts` (new) + `src/service/action-catalog.ts` (new)

`ActionCatalog` builds the list of runnable actions:

```ts
export interface SonarAction {
  id: string;            // e.g. 'aiditor:annotate-selection'
  title: string;         // command name
  source?: string;       // plugin id / 'obsidian'
  hotkey?: string;       // formatted, if bound
  destructive?: boolean; // delete/trash/overwrite heuristic
  run(): void | Promise<void>;
  describe?: string;     // NL description for the Exo tool-surface
}
```

- Built from `app.commands.listCommands()`; `run()` wraps
  `app.commands.executeCommandById(cmd.id)`. Source is parsed from the id
  prefix (`plugin:` → plugin id). Hotkey pulled from `app.hotkeyManager`.
- `destructive` set by a name/id heuristic (`/delete|trash|remove|overwrite/i`).
- Exposed via the plugin object (see cross-plugin below) for the Exo tools.
- Ranking reuses the existing fzf **subsequence matcher** (`src/index/subseq.ts`)
  over `title` + `source`, plus a frecency boost keyed on the action id (see
  frecency change). `CommandMode.rows()` returns matched actions as `OmniRow`s
  whose `activate()` bumps frecency then `run()`s then closes.

### Capture mode — `src/ui/modes/capture-mode.ts` (new) + `src/service/capture.ts` (new)

- `rows(stripped)` returns a **single preview `OmniRow`**: title `Capture`,
  subtitle `→ Daily · 🌱 Capture` (or `→ Task · 📅 today` when the line starts
  `[ ]`/`- [ ]`), icon `plus`, disabled/greyed when `stripped` is empty.
- `activate()` calls `appendCapture(app, text)` then closes.
- `appendCapture` resolves today's daily via the Daily Notes plugin interface
  if present, else `Journal/Daily/DD-MM-YYYY.md` per vault convention; ensures a
  `## 🌱 Capture` section exists; appends the line as **raw text** via
  `vault.process`/`app.vault.append` — never `processFrontMatter`. Task lines
  become `- [ ] <text> 📅 YYYY-MM-DD`.

### Intent mode — `src/ui/modes/intent-mode.ts` (new)

- `rows(stripped)` returns a single preview `OmniRow`: title `Ask Exo`,
  subtitle the intent text, aux `→ Exo`, icon `sparkles`; greyed when empty or
  when `exoPlugin()` is null (with subtitle "Exo not available").
- `activate()` calls the modal's existing `askExo(stripped)` (which already
  routes to `exo.askExo(query, /* autoSend defaults */)`) — extended to pass
  `autoSend: true`. Execution capability comes from Exo having the
  `run_sonar_action` tool; IntentMode itself only hands off the text.

### `src/ui/modal.ts` (changed)

- New private field `mode: Mode` + `stripped: string`, derived from the input
  on every keystroke via `parseSigil`.
- **Input handler**: on change, run `parseSigil(value)`. If the sigil changed,
  update the mode pill (`renderModeChip()`), swap the placeholder, and clear
  the results before re-querying. Backspace that empties the input resets to
  search mode.
- `renderModeChip()`: when `mode.sigil !== ''`, render a pill left of the input
  — label `mode.chipLabel`, `data-accent` = `mode.accent`, a vertical divider,
  **no filled background** (border/geometry + accent text only). Empty for
  search.
- `refresh()`: branch on `mode.sigil`.
  - `''` → existing search path (registry query / buildBrowse), untouched.
  - else → `void mode.rows(this.stripped, this.modeContext()).then(rows =>
    this.renderModeRows(rows))`.
- `renderModeRows(rows: OmniRow[])`: renders `OmniRow`s reusing the current row
  DOM (`sonar-result__main` etc.); applies `data-accent` to the row icon;
  wires click + selection to `row.activate(mod)`. Keyboard (`↑↓`, `↵`, `⌘↵`,
  `esc`) unchanged — `activate(index, newTab)` gains an `OmniRow` branch when a
  mode is active.
- **Empty-state grammar hint**: in `buildBrowse()` (the empty-query browse
  view), append a static, non-selectable footer row:
  `>  commands   ·   +  capture   ·   ?  ask Exo`. Text only, no card.
- `RowItem` gains an optional `omni?: OmniRow` so `activate()` can dispatch to
  it; `create`/`exo` synthetic rows stay as-is.

### `src/service/frecency.ts` (changed)

`FrecencyTracker` currently keys on file paths. Add action-id support so
command mode ranks by use. Either reuse the same map with `cmd:<id>` keys or
add a parallel `actions` map; a `bumpAction(id)` + `actionBoost(id)` pair
mirrors the existing `boost()` API. Persisted in `frecency.json` alongside file
entries.

### `src/main.ts` (changed)

- Construct the `ActionCatalog` object at load (after the registry wiring), but
  populate it **lazily on the first command-mode query** and cache the result;
  invalidate the cache on plugin enable/disable via the workspace
  `layout-change` event. (No eager scan of `app.commands` at boot.)
- Instantiate the four modes and pass them into `openModal()` via `ModalDeps`
  (new field `modes: Mode[]`), or construct them in the modal from `deps`.
- Expose the cross-plugin API on the plugin instance (below).

### Cross-plugin API (this repo's surface for Exo)

On the Sonar plugin object, mirroring aiditor's precedent:

```ts
getActions(): SonarActionInfo[]                 // id, title, source, destructive, describe
runAction(id: string, opts?): Promise<RunResult> // executes; honors `destructive` gate
```

`SonarActionInfo` is the serializable subset (no `run` closure). The **exo repo**
adds `list_sonar_actions` (read) + `run_sonar_action` (write, confirms on
`destructive`) tools that call these — tracked as a companion task, not built
here.

## Appearance

Centered floating palette (desktop) + bottom-sheet (mobile), unchanged form.

Empty state (teaches the grammar):

```
┌──────────────────────────────────────────────┐
│ ⌕  Search, or type a command…                  │
├──────────────────────────────────────────────┤
│ RECENT                                          │
│ ▸ Captoo GTM Playbook              2m ago       │
│ ▸ 13-07-2026 · Daily               now          │
├──────────────────────────────────────────────┤
│  >  commands   ·   +  capture   ·   ?  Exo      │  ← text hint, no card
└──────────────────────────────────────────────┘
```

Command mode (pill = geometry + accent, not a filled box):

```
┌──────────────────────────────────────────────┐
│ ❯ Command │ annotate…                           │
├──────────────────────────────────────────────┤
│ ▸ Annotate selection      aiditor      ⌘⇧A     │
│ ▸ Ask Exo about note      exo                   │
└──────────────────────────────────────────────┘
```

Per-mode accent lives only on the pill/divider and the row icon; the rest of
the surface stays neutral. Mobile: sigils are typed (they work on the soft
keyboard); tappable mode segments in the grabber area are a **later** refinement,
not v1.

⚠️ Grep Sonar's `styles.css` before adding styles — match Sonar's own visual
language, not exo's `.mva-*` tokens.

## Out of scope (v1)

- `registerActions()` rich/argued actions from suite plugins — command mode
  relies on the native command list. The API is defined but the only producer
  is the native catalog.
- Tappable mobile mode segments (sigils only for v1).
- Exo *executing* multi-step plans autonomously beyond calling `run_sonar_action`
  — Exo's own turn logic owns that.
- Rapid-fire capture (Enter closes).
- Any change to the persisted content index (`index.bin`) format or the
  `/search` HTTP contract.

## Testing

- `modes.test.ts`: `parseSigil` maps each sigil + default; strips the sigil;
  backspace-to-empty returns search.
- `action-catalog.test.ts`: builds actions from a fake `app.commands`; source
  parsed from id prefix; `destructive` heuristic; subseq ranking order.
- `capture.test.ts`: `appendCapture` produces raw text under `## 🌱 Capture`;
  creates the section when missing; task detection writes `- [ ]` + `📅` date;
  asserts it never touches frontmatter (feed a note with unquoted
  `company: [[X]]` frontmatter and assert it's byte-identical after).
- `frecency.test.ts`: `bumpAction`/`actionBoost` round-trip and persist.
- Manual: reload plugin (build writes `main.js` into the vault via
  `.obsidian-plugin-dir` — never `cp` the stale repo `main.js`); walk all four
  modes incl. the mobile bottom-sheet; confirm search mode is byte-for-byte
  unchanged; confirm `? ...` launches Exo and (with the companion exo tools) it
  can call a Sonar action.
