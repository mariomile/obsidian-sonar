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
