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
