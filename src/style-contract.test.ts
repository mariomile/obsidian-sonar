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
});
