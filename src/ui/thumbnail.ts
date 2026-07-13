import { type App, type Component, MarkdownRenderer, setIcon, TFile } from 'obsidian';
import type { DocType } from '../index/fields.ts';
import type { SearchService } from '../service/search-service.ts';
import { iconFor } from './icons.ts';

/** Cap the markdown we mini-render — a few opening lines is all that's visible
 *  once scaled down, and it keeps the first render cheap. The box width and
 *  scale live in styles.css (`--sonar-thumb-*`). */
const PREVIEW_CHARS = 400;

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg']);

/** The minimal shape a thumbnail needs from a result row. */
export interface ThumbItem {
  path: string;
  basename: string;
  docType: DocType;
  ext?: string;
}

/**
 * Renders a small mini-preview for each result: for notes, a scaled-down live
 * markdown render of the note's opening (text, headings, callouts, embedded
 * images); for image files, the image itself; otherwise a file-type icon.
 *
 * Two ideas keep it fast enough for a search list that rebuilds on every
 * keystroke:
 *   1. **Lazy** — a row's preview is only rendered once it scrolls within view
 *      (IntersectionObserver on the results scroller), so an off-screen match is
 *      never rendered.
 *   2. **Cached** — the rendered inner is memoised by `path + mtime`, so once a
 *      note has been mini-rendered, later keystrokes clone the cached subtree
 *      (cheap) instead of re-running MarkdownRenderer.
 */
export class ThumbnailRenderer {
  private readonly cache = new Map<string, { mtime: number; inner: HTMLElement }>();
  private readonly pending = new WeakMap<HTMLElement, ThumbItem>();
  private io: IntersectionObserver;

  constructor(
    private readonly app: App,
    private readonly service: SearchService,
    private readonly component: Component,
    private readonly root: HTMLElement,
  ) {
    this.io = this.makeObserver();
  }

  private makeObserver(): IntersectionObserver {
    return new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const box = entry.target as HTMLElement;
          this.io.unobserve(box);
          const item = this.pending.get(box);
          if (item) {
            this.pending.delete(box);
            void this.fill(box, item);
          }
        }
      },
      { root: this.root, rootMargin: '240px 0px' },
    );
  }

  /** Drop all outstanding observations — call before rebuilding the row list so
   *  discarded rows don't pin detached nodes in the observer. The cache (the
   *  expensive part) is preserved. */
  resetObservations(): void {
    this.io.disconnect();
    this.io = this.makeObserver();
  }

  /** Attach a thumbnail to `box`; shows a file-type icon immediately, then fills
   *  in the real preview once the row scrolls into view. */
  mount(box: HTMLElement, item: ThumbItem): void {
    box.addClass('sonar-thumb');
    const fallback = box.createDiv({ cls: 'sonar-thumb__icon' });
    setIcon(fallback, iconFor(item.ext, item.docType));
    this.pending.set(box, item);
    this.io.observe(box);
  }

  private async fill(box: HTMLElement, item: ThumbItem): Promise<void> {
    const inner = await this.render(item);
    if (!inner || !box.isConnected) return;
    box.empty();
    box.appendChild(inner);
    box.addClass('is-rendered');
  }

  private async render(item: ThumbItem): Promise<HTMLElement | null> {
    const file = this.app.vault.getAbstractFileByPath(item.path);
    const mtime = file instanceof TFile ? file.stat.mtime : 0;
    const hit = this.cache.get(item.path);
    if (hit && hit.mtime === mtime) return hit.inner.cloneNode(true) as HTMLElement;

    const inner = createDiv({ cls: 'sonar-thumb__inner markdown-rendered' });
    const ext = (item.ext ?? '').toLowerCase();

    if (IMAGE_EXTS.has(ext) && file instanceof TFile) {
      inner.addClass('is-image');
      const img = inner.createEl('img');
      img.src = this.app.vault.getResourcePath(file);
    } else {
      const md = await this.service.previewMarkdown(item.path);
      if (!md) return null;
      await MarkdownRenderer.render(
        this.app,
        md.slice(0, PREVIEW_CHARS),
        inner,
        item.path,
        this.component,
      );
    }

    this.cache.set(item.path, { mtime, inner });
    return inner.cloneNode(true) as HTMLElement;
  }

  dispose(): void {
    this.io.disconnect();
    this.cache.clear();
  }
}
