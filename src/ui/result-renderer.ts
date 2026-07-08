import { setIcon } from 'obsidian';
import { tokenize } from '../index/tokenizer.ts';
import type { DocType } from '../index/fields.ts';
import type { Excerpt, HighlightRange } from '../types.ts';
import { iconFor } from './icons.ts';

/** The minimal shape a row needs to render — browse items lack score/excerpt. */
export interface RenderableResult {
  path: string;
  basename: string;
  docType: DocType;
  /** Raw file extension (lowercase), for icon selection on non-content files. */
  ext?: string;
  /** Provider that produced this result (shown in debug mode). */
  source?: string;
  matched: string[];
  score?: number;
  excerpt?: Excerpt;
}

/** Append `text` to `parent`, wrapping the given ranges in <mark> spans. */
export function renderHighlighted(parent: HTMLElement, text: string, ranges: HighlightRange[]): void {
  if (ranges.length === 0) {
    parent.appendText(text);
    return;
  }
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start < cursor || start >= text.length) continue; // skip overlaps/out-of-range
    if (start > cursor) parent.appendText(text.slice(cursor, start));
    parent.createEl('mark', { cls: 'sonar-mark', text: text.slice(start, Math.min(end, text.length)) });
    cursor = Math.min(end, text.length);
  }
  if (cursor < text.length) parent.appendText(text.slice(cursor));
}

/** Highlight ranges over a basename by matching its tokens against `matched`. */
function basenameRanges(basename: string, matched: string[]): HighlightRange[] {
  const set = new Set(matched);
  const ranges: HighlightRange[] = [];
  for (const tok of tokenize(basename)) {
    if (set.has(tok.text)) ranges.push([tok.start, tok.end]);
  }
  return ranges;
}

export interface RowOptions {
  selected: boolean;
  showScore: boolean;
  onClick: (modKey: boolean) => void;
  onContext?: (e: MouseEvent) => void;
}

/** Render one search result row and return its element. */
export function renderResultRow(
  container: HTMLElement,
  result: RenderableResult,
  opts: RowOptions,
): HTMLElement {
  const row = container.createDiv({ cls: 'sonar-result' });
  if (opts.selected) row.addClass('is-selected');

  const icon = row.createDiv({ cls: 'sonar-result__icon' });
  setIcon(icon, iconFor(result.ext, result.docType));

  const main = row.createDiv({ cls: 'sonar-result__main' });

  const titleRow = main.createDiv({ cls: 'sonar-result__titlerow' });
  const title = titleRow.createDiv({ cls: 'sonar-result__title' });
  renderHighlighted(title, result.basename, basenameRanges(result.basename, result.matched));
  if (opts.showScore && result.score !== undefined) {
    titleRow.createSpan({ cls: 'sonar-result__score', text: result.score.toFixed(2) });
  }
  if (opts.showScore && result.source) {
    titleRow.createSpan({ cls: 'sonar-result__source', text: result.source });
  }

  const dir = result.path.includes('/') ? result.path.slice(0, result.path.lastIndexOf('/')) : '';
  if (dir) main.createDiv({ cls: 'sonar-result__path', text: dir });

  if (result.excerpt && result.excerpt.text) {
    const ex = main.createDiv({ cls: 'sonar-result__excerpt' });
    renderHighlighted(ex, result.excerpt.text, result.excerpt.ranges);
  }

  row.addEventListener('click', (e) => opts.onClick(e.metaKey || e.ctrlKey));
  if (opts.onContext) {
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      opts.onContext!(e);
    });
  }
  return row;
}
