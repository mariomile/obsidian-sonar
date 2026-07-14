import { type App, Component, MarkdownRenderer, setIcon } from 'obsidian';

/** The slice of SearchService the preview needs to fetch content. */
export interface PreviewSource {
  previewMarkdown(path: string): Promise<string | undefined>;
  htmlSource(path: string): Promise<string | undefined>;
}

/** A file the preview can render — path + basename, plus an optional cached ext. */
export interface PreviewItem {
  path: string;
  basename: string;
  ext?: string;
}

/** Lowercase file extension from a path, or '' if none. */
function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot + 1).toLowerCase() : '';
}

/**
 * Renders the right-pane preview of the selected file: a sandboxed iframe for
 * `.html` artifacts (CSS applies, scripts blocked, no style bleed), a
 * formatted-markdown excerpt for everything else. Owns its own render
 * Component and a generation guard so a stale async render can't paint over a
 * newer selection. Self-contained, mirroring ThumbnailRenderer's shape.
 */
export class PreviewRenderer {
  private readonly component = new Component();
  private gen = 0;
  private renderedPath: string | null = null;

  constructor(
    private readonly app: App,
    private readonly source: PreviewSource,
    private readonly el: HTMLElement,
    private readonly onOpenFile: (path: string) => void,
  ) {
    this.component.load();
  }

  /** Render `item`, or clear the pane when null (nothing / a synthetic row). */
  render(item: PreviewItem | null): void {
    if (!item) {
      this.el.empty();
      this.el.addClass('is-empty');
      this.renderedPath = null;
      return;
    }
    if (item.path === this.renderedPath) return; // already showing this note
    this.renderedPath = item.path;
    this.el.removeClass('is-empty');
    this.el.empty();

    const header = this.el.createDiv({ cls: 'sonar-preview__header' });
    const heading = header.createDiv({ cls: 'sonar-preview__heading' });
    heading.createDiv({ cls: 'sonar-preview__title', text: item.basename });
    const dir = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
    if (dir) heading.createDiv({ cls: 'sonar-preview__path', text: dir });

    const open = header.createEl('button', {
      cls: 'sonar-icon-btn',
      attr: { 'aria-label': 'Open note' },
    });
    setIcon(open.createSpan({ cls: 'sonar-icon-btn__glyph' }), 'external-link');
    open.addEventListener('click', () => this.onOpenFile(item.path));

    const bodyEl = this.el.createDiv({ cls: 'sonar-preview__body' });
    const gen = ++this.gen;

    if ((item.ext ?? extOf(item.path)) === 'html') {
      void this.source.htmlSource(item.path).then((html) => {
        if (gen !== this.gen) return;
        bodyEl.empty();
        if (!html) {
          bodyEl.createEl('em', { cls: 'sonar-preview__empty', text: 'No preview available.' });
          return;
        }
        const frame = bodyEl.createEl('iframe', { cls: 'sonar-preview__frame' });
        frame.setAttribute('sandbox', ''); // renders CSS, blocks scripts
        frame.srcdoc = html;
      });
      return;
    }

    bodyEl.addClass('markdown-rendered');
    void this.source.previewMarkdown(item.path).then((md) => {
      if (gen !== this.gen) return;
      bodyEl.empty();
      if (!md) {
        bodyEl.createEl('em', { cls: 'sonar-preview__empty', text: 'No preview available.' });
        return;
      }
      void MarkdownRenderer.render(this.app, md, bodyEl, item.path, this.component);
    });
  }

  dispose(): void {
    this.component.unload();
  }
}
