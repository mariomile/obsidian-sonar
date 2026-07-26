import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * mv-kit style contract (obsidian-cosmos-theme/docs/mv-kit.md).
 *
 * Encodes only the state landed by the 2026-07 mv-kit audit wave — not
 * aspirational rules the audit didn't actually fix. See the audit note at
 * docs/2026-07-mv-kit-audit.md for the full per-rule verdict.
 */

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** Strip comments so `/* 80ms *\/`-style prose in doc comments doesn't
 * trip the raw-value scan below. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('mv-kit style contract', () => {
  // Regression guard for a real outage (2026-07-24): a comment written as
  // `--cosmos-*` immediately followed by a slash terminates the comment early.
  // Everything after it parses as garbage and the browser DROPS the enclosing
  // rule — which silently cost `.sonar-modal` its `width: 880px`, collapsing
  // the modal to Obsidian's 560px default. Invisible to eslint/tsc/vitest and
  // to the raw-value scan below, so it gets its own assertion.
  it('no CSS comment terminates early (token glob followed by a slash)', () => {
    const offenders = css
      .split('\n')
      .map((line, idx) => ({ line: line.trim(), n: idx + 1 }))
      .filter(({ line }) => /--[\w-]*\*\//.test(line));

    expect(offenders).toEqual([]);
  });

  it('stripping comments leaves no orphaned prose (structural parse check)', () => {
    // If a comment closed early, its remaining lines survive the strip as
    // stray ` * ...` prose sitting in declaration position.
    const orphans = stripComments(css)
      .split('\n')
      .map((line, idx) => ({ line: line.trim(), n: idx + 1 }))
      .filter(({ line }) => /^\*\s|^\*$/.test(line));

    expect(orphans).toEqual([]);
  });

  it('raw ms/hex/cubic-bezier values appear only as var() fallbacks', () => {
    const code = stripComments(css);
    const lines = code.split('\n');

    // A raw ms/hex/cubic-bezier is allowed ONLY when it sits inside a
    // `var(--cosmos-*, <fallback>)` or `var(--mv-*, <fallback>)` expression —
    // i.e. the line contains `var(--cosmos-` or `var(--mv-` before the raw
    // value. This is a line-level heuristic (matches the audit procedure in
    // mv-kit.md §"Audit procedure": grep for raw values outside a var()
    // fallback), not a full CSS parse.
    const rawMsPattern = /\b\d+ms\b/g;
    const rawHexPattern = /#[0-9a-fA-F]{3,8}\b/g;
    const rawCubicBezierPattern = /cubic-bezier\([^)]*\)/g;

    const violations: string[] = [];

    lines.forEach((line, idx) => {
      // A raw value is allowed when it sits as the fallback inside ANY
      // var(--token, <fallback>) expression (native Obsidian tokens like
      // --color-base-00 included) — the contract's requirement is "never a
      // bare value", not "only --cosmos-*/--mv-* tokens may have fallbacks".
      const hasVarFallback = /var\(\s*--[\w-]+\s*,/.test(line);

      for (const pattern of [rawMsPattern, rawHexPattern, rawCubicBezierPattern]) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          if (!hasVarFallback) {
            violations.push(`line ${idx + 1}: "${match[0]}" in "${line.trim()}"`);
          }
        }
      }
    });

    expect(violations).toEqual([]);
  });

  it('caps !important declarations at the post-mv-kit-audit count (ratchet down only)', () => {
    const importantCount = (css.match(/!important;/g) ?? []).length;
    // Ceiling set exactly at the post-fix count landed by the mv-kit audit
    // (2026-07): a documented, deliberate specificity block (focus-ring kill,
    // ~lines 115-140) plus the full-bleed phone-sheet overrides (~lines
    // 525-595) that must outrank Obsidian core/theme mobile-modal defaults.
    // Every occurrence carries an adjacent comment explaining why. Any new
    // edit that adds an !important without removing one fails this test —
    // the ceiling can only ratchet down.
    expect(importantCount).toBeLessThanOrEqual(16);
  });

  // mv-kit §6 (Elevation & motion depth) — wave 2026-07 dinamica, per
  // docs/2026-07-mv-kit-audit.md's "§6 — wave 2026-07 dinamica" section.
  //
  // "A touch tap must never leave a stuck hover state — plugins must not
  // fight it with custom :hover outside @media (hover: hover) on
  // phone-reachable elements." A bare `.sonar-*:hover { ... }` rule at the
  // stylesheet's top level fires on tap on touch browsers (there is no
  // pointer to leave, so the visual state "sticks" until an unrelated tap
  // elsewhere). Every `.sonar-*:hover` selector must therefore sit inside an
  // `@media (hover: hover)` block. `:focus-visible` is exempt (keyboard-only,
  // must never be hover-gated) and is excluded by the selector match itself.
  it('§6: every .sonar-*:hover rule is gated behind @media (hover: hover)', () => {
    const lines = stripComments(css).split('\n');
    const violations: string[] = [];

    // Real brace-depth tracking: each open @media records the nesting depth
    // it was opened at plus whether it is a hover:hover query, and is only
    // popped when depth unwinds back to that level — so a `.foo:hover { }`
    // rule's own closing `}` inside the @media doesn't falsely pop it.
    let depth = 0;
    const mediaStack: { openedAtDepth: number; isHoverGate: boolean }[] = [];

    lines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      const mediaOpen = /^@media\s*\(([^)]*)\)\s*\{/.exec(line);
      if (mediaOpen) {
        mediaStack.push({ openedAtDepth: depth, isHoverGate: /hover:\s*hover/.test(mediaOpen[1] ?? '') });
      }

      if (/\.sonar-[\w-]+(?:[.:][\w-]+)*:hover\b/.test(line)) {
        const insideHoverGate = mediaStack.some((m) => m.isHoverGate);
        if (!insideHoverGate) {
          violations.push(`line ${idx + 1}: "${line}"`);
        }
      }

      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      depth += opens - closes;

      let top = mediaStack.at(-1);
      while (top !== undefined && depth <= top.openedAtDepth) {
        mediaStack.pop();
        top = mediaStack.at(-1);
      }
    });

    expect(violations).toEqual([]);
  });

  // mv-kit §6: colour/opacity washes ease with --mv-wash, physical transforms
  // ease with --mv-lift — the two are not interchangeable. Every `.sonar-*`
  // hover in this file is a colour/opacity wash (background-color/color/
  // opacity), so their `transition` declarations must resolve through the
  // --sonar-wash-ease alias (--mv-wash), never the --sonar-ease alias
  // (--mv-lift, reserved for a future genuine transform).
  it('§6: colour/opacity transitions never pair with the --sonar-ease (--mv-lift) alias', () => {
    const lines = stripComments(css).split('\n');
    const violations: string[] = [];

    lines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      if (!/^transition:/.test(line)) return;
      const groups = line.replace(/^transition:\s*/, '').replace(/;$/, '').split(',');
      for (const group of groups) {
        const isWashProperty = /^(background-color|color|opacity)\b/.test(group.trim());
        // Match --sonar-ease but not --sonar-wash-ease (word-boundary guard).
        if (isWashProperty && /var\(--sonar-ease\)/.test(group)) {
          violations.push(`line ${idx + 1}: "${group.trim()}"`);
        }
      }
    });

    expect(violations).toEqual([]);
  });
});
