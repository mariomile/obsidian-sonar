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

---

## §6 — wave 2026-07 dinamica

Audit of `styles.css` (793 lines pre-fix) + `src/ui/modal.ts` against
`obsidian-cosmos-theme/docs/mv-kit.md` §6 "Elevation & motion depth" (commit
`10f5ddc`, cantiere 2 — "Dinamica & profondità"). Scope: motion/elevation
coherence only — no layout redesign, no new components, per brief non-goals.
Sonar is the first plugin through cantiere 2 in the suite's rollout order
(Sonar → Portal → Masonry → TabX); Portal's and TabX's own §6 waves (commits
`389d564`/`133c93d`/`4b95bf2` and `cc65cd4`/`a792752`/`662d11a`) were consulted
as the pattern to replicate, not as authority for Sonar's own findings — every
verdict below is argued from mv-kit.md's text and from Sonar's own surfaces.

Per-rule verdict: **pass** (already compliant, nothing to do) / **fixed**
(this wave) / **waived** (kit rule doesn't literally apply to this surface,
with reason) / **N/A** (no surface of this type exists in the plugin at all).

### Elevation hierarchy

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| `.sonar-modal` (the omni-bar — brief explicitly names it a Pop-tier surface: floats over content, closes on outside-click) | **was a violation**: no Sonar-owned `box-shadow` anywhere on `.sonar-modal`; it relied entirely on Obsidian's native `.modal` shadow, which Cosmos does not itself upgrade to the Pop token for a plain `.modal` (confirmed by reading `cosmos-tweaks.css`/`cosmos-phone.css` — Cosmos only applies `--cosmos-pop-shadow` to `.modal.mod-settings .vertical-tab-header` under a specific floating-settings flavour toggle, never to `.modal` generally) | same selector, device-agnostic declaration | **fixed** — added `box-shadow: var(--cosmos-pop-shadow, var(--shadow-l))` directly to `.sonar-modal`. Fallback matches the convention already used by sibling suite plugins for a comparable floating surface (`obsidian-aiditor`'s `.aiditor-popover` uses `var(--cosmos-pop-shadow, var(--shadow-l))`; `obsidian-composer`'s smaller command menu uses `--shadow-s`) — `--shadow-l` fits Sonar's 880px-wide modal better than the smaller `-s` tier. |
| Phone sheet (`.is-phone .sonar-modal` / `.sonar-modal.is-narrow`) | n/a | Same `box-shadow` declaration applies (no phone-specific override) — matches §6's explicit note that "on phone, Pop becomes the bottom-sheet elevation" without requiring a distinct rule; the sheet-rise animation (`--cosmos-t-panel`/`--cosmos-native`) was already compliant pre-wave (wave 1, §3) | **pass** (post-fix) — no phone-specific box-shadow override needed; the base `.sonar-modal` rule the fix landed on already covers the phone sheet since nothing un-sets `box-shadow` in the phone media blocks. |
| Stacked tiers | Only one shadow declaration in the file post-fix (`.sonar-modal`'s new Pop shadow); no other floating/persistent surface (`.sonar-preview`, `.sonar-chip`, etc.) carries a `box-shadow` at all | same | **pass** — no stacking; `.sonar-preview`'s border+background is a static in-flow pane (Flat tier per the kit's table — "inline chrome that sits in the document flow"), not a floating surface, so it correctly carries no shadow. |

### Hover richness

| Rule | Desktop | Phone | Verdict |
|---|---|---|---|
| Colour **and** lift, never colour alone | All 5 `:hover` rules in `styles.css` (`.sonar-icon-btn`, `.sonar-input-clear`, `.sonar-chip`, `.sonar-chip__clear`, `.sonar-result`) are colour/opacity washes only (`background-color`, `color`, `opacity`) on dense controls/list rows — no `transform` lift on any of them | same | **pass, waived** — mv-kit's own code example under this rule shows `.row:hover` (colour-only) and `.card:hover` (lift-only) as two *distinct* patterns for two different surface shapes, not one rule both must satisfy. Every Sonar hover target here is either a small icon-button/chip control or a dense list row (`.sonar-result`), never a card-shaped surface — this matches the precedent already recorded in Portal's own §6 wave (`obsidian-portal`'s dense tree rows vs `obsidian-masonry`'s grid cards). Adding a `translateY` lift to a 28px icon button or a dense result row would read as jitter, not the "hint" the kit describes for cards. No lift-transform hover exists in Sonar to check against the ≤2px cap, so that MUST is vacuously satisfied. |
| `--mv-wash` for colour transitions, `--mv-lift` for transform transitions (not interchangeable) | **was a violation**: the single `--sonar-ease` alias (`--cosmos-t-fast` + `--mv-lift`) was used for every `transition` in the file, including all colour/opacity wash transitions that should ease with `--mv-wash` — there is no transform-lift hover anywhere in the file, so `--mv-lift` had no genuine use to begin with | same fix applies (`--sonar-ease` is device-agnostic) | **fixed** — added a second alias `--sonar-wash-ease: var(--cosmos-t-fast, 140ms) var(--mv-wash, cubic-bezier(0.25, 1, 0.5, 1))` next to `--sonar-ease` in `.sonar-modal`'s local-token block, and repointed the four `transition` declarations that reference it (`.sonar-icon-btn`, `.sonar-input-clear`, `.sonar-chip`, `.sonar-result`) to the new alias. `--sonar-ease` (`--mv-lift`) is kept defined but currently has zero consumers — reserved for a future genuine transform, not removed, since removing an unused-but-correctly-named token isn't a §6 violation fix. `.sonar-chip__clear:hover` has no `transition` declared at all (pre-existing, unrelated to this fix) so it needed only the hover-gate below, not a token repoint. Guarded by a new style-contract test. |
| `transform` lift never exceeds 2px | n/a — no lift-transform hover exists (see row above) | same | **pass, not applicable** |
| Hover gated to `@media (hover: hover)` on phone-reachable elements | **was a violation**: 0 of the file's 5 `:hover` rules were wrapped in `@media (hover: hover)`. All 5 targets are phone-reachable: `.sonar-icon-btn`/`.sonar-input-clear` sit in the input row (visible on the phone sheet), `.sonar-chip`/`.sonar-chip__clear` render inside the phone chips strip (icon-only variant, `.is-phone .sonar-chip`), `.sonar-result` is the primary phone-sheet touch target (full-width tap row, `.is-phone .sonar-result` padding override already exists) | same rule, now fixed | **fixed** — wrapped all 5 `:hover` rules in `@media (hover: hover)`. None of the 5 relies on `:hover` for *visibility* (no `opacity: 0` base state toggled only by hover) — `.sonar-input-clear` visibility is driven by the JS-toggled `.is-visible` class, `.sonar-chip__clear` is always `display: flex`, `.sonar-result`/`.sonar-icon-btn`/`.sonar-chip` are always rendered — so gating introduces no touch-reachability regression requiring a phone fallback (unlike Portal's `.portal-collection-open`, which needed one). Guarded by a new style-contract test. |

### Drag polish

| Surface | Desktop | Phone | Verdict |
|---|---|---|---|
| Drag positioning via `transform`, never `left`/`top`/`margin` | n/a — Sonar has no desktop drag surface | n/a | **N/A, nessuna superficie di questo tipo su desktop** |
| Drop settle via `--cosmos-native` | n/a | The phone sheet's own drag-to-dismiss gesture (`setupSheetGestures()` in `src/ui/modal.ts`) *does* exist and *is* transform-only (`this.modalEl.style.transform = `translateY(${dy}px)`` while dragging, never `left`/`top`) — but its settle transition is a raw inline JS string, `'transform 220ms cubic-bezier(0.32, 0.72, 0, 1)'`, not `--cosmos-native`/`--cosmos-t-panel` tokens, and not CSS at all | **waived, pre-existing, out of this wave's scope** — mv-kit's own "Audit procedure" step 1 scopes the raw-value grep to "the plugin's stylesheet"; `docs/2026-07-mv-kit-audit.md`'s own wave-1 §3 verdict already recorded this exact gesture as deferred ("`setupSheetGestures()` raw motion values in `modal.ts` — kit's audit procedure scopes to the stylesheet; fixing gesture-driven inline styles is a behavior change, deferred"). This wave does not reopen that deferral: the transform-only constraint (the concrete §6 MUST under audit) is already satisfied by the existing code, and re-wiring the JS string to consume CSS custom properties via `getComputedStyle` would be a behavior change beyond a mechanical compliance sweep. |

### Panel & tab transitions

**N/A, nessuna superficie di questo tipo.** Confirmed by reading `src/ui/`,
`src/service/`, and `src/index/` in full: Sonar owns no persistent
panel/sidebar (the omni-bar is a modal, Pop-tier, not Island — see Elevation
hierarchy above) and no tab-content-swap UI of any kind. The only
open/close-shaped motion in the plugin is the phone sheet's rise-in
animation, already audited and found compliant in wave 1 (§3): it uses
`--cosmos-t-panel`/`--cosmos-native` correctly, which is the same token pair
this rule would require were there a literal panel to check.

### Not touched (explicit non-goals, confirmed out of scope)

- No layout/DOM changes anywhere — every fix in this wave is a CSS-only
  token-repoint (`--sonar-ease` → `--sonar-wash-ease` on 4 declarations), a
  `@media` wrapper addition (5 `:hover` rules), or one new `box-shadow`
  declaration on `.sonar-modal`.
- `src/ui/modal.ts`'s `setupSheetGestures()` raw transition string — waived,
  not fixed; see Drag polish above. Matches wave 1's own precedent for the
  same code.
- Card-style lift-on-hover for `.sonar-result`/chips/icon-buttons — waived;
  none of Sonar's hover targets are card-shaped, per the kit's own row/card
  example (see Hover richness above).
- `--sonar-ease` alias itself — kept defined even though it now has zero
  consumers in the file; not a §6 violation to leave an unused, correctly-
  named token in place, and removing it is out of this mechanical sweep's
  scope.

### Verification

- `pnpm typecheck` — 0 errors
- `pnpm lint` — 0 issues
- `pnpm test` — 28 test files, 190 tests passing (188 pre-existing + 2 new in
  `src/style-contract.test.ts`): "§6: every `.sonar-*:hover` rule is gated
  behind `@media (hover: hover)`" and "§6: colour/opacity transitions never
  pair with the `--sonar-ease` (`--mv-lift`) alias". Both new assertions were
  red-green verified: each fix was individually reverted, the corresponding
  test observed to fail (confirmed against the actual assertion failure
  output, not assumed), then restored and re-confirmed green — the other
  188 pre-existing tests stayed green throughout both reverts.
- `pnpm build` — succeeded (part of `pnpm release:check`, which also re-runs
  lint + test + typecheck as its `build` prerequisite).
- Desktop screenshot / live vault reload verification: **pending** — not
  performed this wave (no live vault-reload check run in this session).
- Phone verification: **pending Mario's on-device sign-off** — per hard
  constraint, Obsidian's `EmulateMobile` was not used (it kills Node
  plugins); phone changes (hover-gate correctness — none of the 5 gated
  targets needed a touch-reachability fallback, see Hover richness above —
  and the new Pop shadow, which is device-agnostic) are verified by reading
  the resulting CSS against the kit's phone column and against Sonar's own
  existing `.is-phone`/`.sonar-modal.is-narrow` precedent in the same file.
