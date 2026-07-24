# mv-kit audit — Sonar (wave 1)

Audit of `styles.css` + `src/ui/*` (`modal.ts`, `result-renderer.ts`,
`src/ui/modes/`, `src/settings-tab.ts`) against
`obsidian-cosmos-theme/docs/mv-kit.md`, both desktop and phone columns.
Scope: coherence-only fixes (radius / type / icons / motion tokens / empty
states / microcopy). No layout redesign, no DOM restructure — per
`docs/2026-07-24-suite-coherence-design.md` §C/D non-goals.

Per-rule verdict: **pass** (already compliant) / **fixed** (this wave) /
**waived** (kit rule doesn't apply here, with reason).

## Golden rule — theme-independent consumption

| Check | Verdict |
|---|---|
| Every `var(--cosmos-*)`/`var(--mv-*)` has a literal fallback | **fixed** — `--sonar-ease` and the phone `sonar-sheet-rise` animation now consume `--cosmos-t-fast`/`--mv-lift` and `--cosmos-t-panel`/`--cosmos-native` respectively, both with literal fallbacks matching the pre-fix values. |
| No plugin stylesheet redefines `--mv-*`/`--cosmos-*` at `:root`/`body` | **pass** — Sonar only ever defines its own `--sonar-*` namespace. |

## §1 Radius + surfaces

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| `.sonar-modal` container radius | `var(--sonar-radius)` → `var(--radius-l, 12px)` | same, native token | **pass** |
| `.sonar-result` / `.sonar-preview` row radius | `var(--sonar-row-radius)` → `var(--radius-m, 8px)` | same | **pass** |
| `.sonar-chip` (filter chip) radius | was hardcoded `7px` | same rule, shared class | **fixed** — now `var(--mv-r1, 6px)`, the suite-wide chip/toolbar token (kit §1: "any plugin-defined radius that visually matches … chip consumes the matching token … not a hand-picked pixel value"). |
| Icon-button / small controls (`--radius-s`) | native token | same | **pass** |
| Phone sheet top corners | n/a | `var(--radius-l, 16px)` on the two top corners only | **pass** — matches kit's floating-surface convention (bottom-sheet rounds only the top). |
| Grab-handle pill (4px bar) / active-filter dot badge (6px circle) | n/a | `border-radius: 999px` literal | **waived** — these are the generic round-cap idiom on fixed tiny shapes (guarantee full roundness regardless of box size), not a "pill/card/chip" *surface* in the kit's §1 sense (`--cosmos-r-fusion-tab` means "full pill for fusion-flavour tab bars", a different semantic). Kit's radius table has no entry for grab-handles/badge-dots. |
| Elevation shadow on `.sonar-preview` / floating surfaces | none defined — plugin has no floating popovers/menus of its own | n/a | **waived** — Sonar's preview pane is an inline flex column, not a floating surface; nothing to consume `--cosmos-pop-shadow` for. |

## §2 Type sizes, icon sizes, touch targets

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| Icon button hit area | `28×28px` (below 44px, but desktop has no touch-min requirement per kit) | was `40×40px` | **fixed on phone** — now `var(--cosmos-touch-min, 44px)` square. Desktop unchanged (kit: "N/A (no minimum enforced)" for desktop). |
| Filter chip hit area | `26px` tall, auto width (mouse-sized, no min enforced on desktop) | was `36px`/`min-width 36px` | **fixed on phone** — now `var(--cosmos-touch-min, 44px)` both axes. Desktop unchanged. |
| Result row / list item tap target | row padding only, whole row is clickable (comfortably >44px tall in practice) | same, plus increased phone padding (`var(--size-4-3) var(--size-4-2)`) already shipped | **pass** |
| Micro-label text size | `var(--font-ui-smaller)` | same | **pass** (see §4 below for the full micro-label recipe fix) |
| Icon sizing | native SVG width/height in px (16px/19px/14px/12px), no separate icon-size scale — matches kit: "Cosmos defines no separate icon-size scale" | same | **pass** |

## §3 Motion

| Token/animation | Before | After | Verdict |
|---|---|---|---|
| `--sonar-ease` (hover/reveal wash: icon buttons, chips, results, input-clear) | raw `80ms ease` | `var(--cosmos-t-fast, 140ms) var(--mv-lift, cubic-bezier(0.22, 1, 0.36, 1))` | **fixed** — this is exactly the kit's "physical hover/reveal easing" (`--mv-lift`), duration on the `--cosmos-t-fast` micro-feedback tier. |
| `sonar-sheet-rise` keyframe animation (phone bottom-sheet entrance) | raw `280ms cubic-bezier(0.32, 0.72, 0, 1)` | `var(--cosmos-t-panel, 300ms) var(--cosmos-native, cubic-bezier(0.32, 0.72, 0, 1))` | **fixed** — structural panel motion; `cosmos-tokens.css`'s own comment on `--cosmos-native` cites this exact Sonar sheet as the reference use-case. |
| `prefers-reduced-motion: reduce` handling | `@media (prefers-reduced-motion: reduce) { animation: none }` on the sheet-rise, independent of token values | unchanged, still present | **pass** — Sonar already had an explicit reduced-motion override in addition to what the token zeroing would provide once Cosmos is present; kept as-is (belt-and-suspenders, matches kit intent). |
| Animated properties | `transform`/`opacity` only (sheet-rise: `transform`; hover washes: `background-color`/`color`) | unchanged | **pass** — kit's "composited properties only" rule is about `transform`/`opacity` specifically for entrance animations; the hover-wash `background-color`/`color` transitions are the suite-wide convention used by every sibling plugin's `--sonar-ease`-equivalent token and aren't flagged by the kit's own audit grep (which only checks raw-value leakage, not property choice on non-entrance transitions). |
| `setupSheetGestures()` drag-settle transition (`src/ui/modal.ts:302`, JS string `'transform 220ms cubic-bezier(0.32, 0.72, 0, 1)'`) | raw values in a TS string, not CSS | unchanged | **waived, out of scope this wave** — the kit's audit procedure targets the plugin's *stylesheet* ("grep the plugin's stylesheet for raw ms/hex…"); this is inline JS behavior code driving a touch-gesture settle animation, not a CSS design surface. Fixing it would mean reading computed `--cosmos-t-*`/`--cosmos-native` values off the DOM inside a gesture handler — a behavior change, not a coherence-only style fix, and outside this wave's non-goal boundary ("no DOM restructure/component rework"). Flagged for a future wave if Mario wants gesture timing tokenized too. |

## §4 Empty-state pattern

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| `.sonar-group` section eyebrow ("Notes", "Today", "Past 7 days", …) | was `font-size: var(--font-ui-smaller); font-weight: var(--font-semibold); color: var(--text-faint)` — missing uppercase/letter-spacing | same class, no phone variant | **fixed** — now matches the kit's micro-label recipe verbatim: added `text-transform: uppercase; letter-spacing: 0.06em;` and switched `font-semibold` → `font-medium` (the exact weight token the kit's shipped Cosmos recipe uses). |
| `.sonar-preview__empty` ("No preview available.") | was `color: var(--text-faint)` only, inheriting `font-size` from the markdown-rendered `<em>` context (`var(--font-ui-small)`, one step too large) | preview pane is hidden on phone (`display: none`), so this string never renders there | **fixed on desktop** — added explicit `font-size: var(--font-ui-smaller)` per the kit's whisper recipe. Phone: **waived, not reachable** (no preview pane on phone by design). |
| Command-mode "No matching command" row | uses the existing `.sonar-result--affordance`/disabled row styling, not a bespoke empty state | same | **pass** — this is a disabled *result row*, not a section empty-state; it correctly reuses row styling rather than inventing a new pattern. |

## §5 Microcopy voice

| Rule | Desktop | Phone | Verdict |
|---|---|---|---|
| Sentence-case labels | Settings tab uses Obsidian's native `Setting`/`PluginSettingTab` API (`new Setting(containerEl).setName('Max results')…`), not the `.mva-pv` custom-form convention | n/a | **pass, correctly out of scope** — `.mva-pv`/`.mva-sel`/`.mva-btn` is the convention for *custom* plugin forms (exo, etc.); Sonar's settings tab delegates entirely to Obsidian's built-in `Setting` component, which already renders sentence-case labels and native form chrome. There is no bespoke form to normalize. |
| No native `<select>` | none found (`grep` for `createEl('select'` / `<select` in `src/`: zero hits) | same | **pass** |
| No `mod-cta` on buttons | none found | same | **pass** |
| English product copy, PM jargon untranslated | all UI strings in `src/ui/modal.ts` / `result-renderer.ts` / `settings-tab.ts` are English | same | **pass** |
| Chip+popover pickers, never native `<select>` | filter chips (`.sonar-chip`) already follow this pattern | icon-only variant on phone, same underlying chip | **pass** |

## §Golden rule — raw-value leakage (repo-wide grep)

Post-fix `styles.css` grep for raw `ms`/hex/`cubic-bezier` outside a
`var(--token, fallback)` expression: **zero hits** (`#fff` at line 255 is a
literal fallback inside `var(--color-base-00, #fff)`; the two motion tokens
fixed above are the only other matches, both now inside `var()` fallbacks).
This is exactly what `src/style-contract.test.ts` now enforces mechanically.

## `!important` audit (~16 occurrences, all judged individually)

The brief flagged "most belong to a deliberate focus-ring kill block around
lines 115–140" — verified true, plus one more block for the phone full-bleed
sheet geometry. mv-kit is silent on `!important` as a hard rule (it isn't
in any MUST/MUST NOT), so each is judged on whether it's a documented,
necessary specificity override vs. gratuitous:

| Block | Count | Verdict |
|---|---|---|
| `.sonar-input`/`.sonar-input-wrap`/`.sonar-input-row` focus-ring kill (`box-shadow`/`outline`/`border`/`background: none/transparent !important`) | 7 | **waived, justified** — documented inline: defeats theme/core `:focus-visible` rings that would otherwise draw a box around the intentionally-flat search field; some themes target `:focus-within` on the wrapper instead of the input, hence the belt-and-suspenders second block. |
| Phone sheet full-bleed geometry (`width`/`max-width`/`height`/`max-height`/`margin: … !important` on `.is-phone .sonar-modal`) | 7 | **waived, justified** — documented inline: Obsidian's mobile modal defaults (`8px` margin box, capped `--dialog-max-height`) match at equal specificity and load *after* Sonar's stylesheet, so `!important` is the only way to win; without it the sheet renders as a floating card with gutters instead of true edge-to-edge. |
| Theme-override re-assertion (`body.is-phone .modal-container .sonar-modal.sonar-modal.sonar-modal { width/max-width: 100vw !important }`) | 2 | **waived, justified** — documented inline: Cosmos/Cupertino ships an equal-specificity `!important` rule of its own for phone modals that loads after Sonar's stylesheet; a mere selector-specificity bump can't out-order a later `!important`, so this one must also carry `!important` to win. The tripled class is the specificity bump; the `!important` is the load-order fix. |

**Total: 16.** None removed — every one is a genuine specificity battle
against Obsidian core or a sibling theme, not a shortcut around normal
cascade. `src/style-contract.test.ts` caps this at 16 exactly (ratchet-down
only): any future edit that adds an `!important` without removing one fails
the contract test.

## Not touched (explicit non-goals, confirmed out of scope)

- No layout/DOM changes anywhere — every fix in this wave is a token
  substitution or a missing property on an already-existing selector.
- `setupSheetGestures()` raw motion values in `modal.ts` (see §3) — kit's
  audit procedure scopes to the stylesheet; fixing gesture-driven inline
  styles is a behavior change, deferred.
- Grab-handle / badge-dot `999px` radii (see §1) — outside the kit's radius
  vocabulary (round-cap idiom, not a pill/card/chip surface).

## Verification

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 issues
- `pnpm test` — 28 test files, 186 tests passing (184 pre-existing + 2 new
  in `src/style-contract.test.ts`)
- Desktop screenshot / live vault reload verification: **pending** — not
  performed this wave (no live vault-reload check run in this session).
- Phone verification: **pending Mario's on-device sign-off** — per hard
  constraint, Obsidian's `EmulateMobile` was not used (it kills Node
  plugins); phone changes (touch targets, motion tokens) are verified by
  reading the resulting CSS values against the kit's phone column, not by
  rendering on-device.
