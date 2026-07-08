import {
  type App,
  Component,
  MarkdownRenderer,
  Menu,
  Modal,
  Notice,
  Platform,
  TFile,
  TFolder,
  setIcon,
} from 'obsidian';
import type { DocType } from '../index/fields.ts';
import { groupByRecency } from '../index/time-buckets.ts';
import type { SonarSettings } from '../settings.ts';
import type { ProviderRegistry } from '../service/provider-registry.ts';
import type { SearchService } from '../service/search-service.ts';
import { renderResultRow } from './result-renderer.ts';
import { FilterSuggest } from './filter-suggest.ts';

export interface ModalDeps {
  registry: ProviderRegistry;
  service: SearchService;
  settings: SonarSettings;
  now: () => number;
}

interface RowItem {
  path: string;
  basename: string;
  docType: DocType;
  ext?: string;
  matched: string[];
  excerpt?: { text: string; ranges: Array<[number, number]> };
  create?: boolean;
  exo?: boolean;
}

/** A file-type filter option. `test` runs against a result's derived extension
 *  and its indexed docType (keyword results carry docType but no ext). */
interface TypeOption {
  key: string;
  label: string;
  test: (ext: string, docType: DocType) => boolean;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'svg', 'heic', 'avif']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi']);

const TYPE_OPTIONS: TypeOption[] = [
  { key: 'note', label: 'Notes', test: (e, d) => e === 'md' || d === 'md' },
  { key: 'pdf', label: 'PDF', test: (e, d) => e === 'pdf' || d === 'pdf' },
  { key: 'image', label: 'Images', test: (e, d) => IMAGE_EXTS.has(e) || d === 'image' },
  { key: 'html', label: 'HTML', test: (e, d) => e === 'html' || e === 'htm' || d === 'html' },
  { key: 'canvas', label: 'Canvas', test: (e) => e === 'canvas' },
  { key: 'base', label: 'Bases', test: (e) => e === 'base' },
  { key: 'audio', label: 'Audio', test: (e) => AUDIO_EXTS.has(e) },
  { key: 'video', label: 'Video', test: (e) => VIDEO_EXTS.has(e) },
];

/** Lowercase file extension from a path, or '' if none. */
function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot + 1).toLowerCase() : '';
}

/** Minimal shape of the Exo plugin's public cross-plugin API. */
interface ExoApi {
  askExo(query: string, autoSend?: boolean): Promise<void>;
}

interface RowGroup {
  label?: string;
  items: RowItem[];
}

interface DateFilter {
  label: string;
  minMtime: number;
}

const BROWSE_LIMIT = 60;
const DAY = 86_400_000;

/**
 * The central search modal — a two-pane, Notion-style quick-find. Empty query
 * shows recent notes grouped by recency; typing switches to a flat relevance
 * list. The right pane renders a formatted markdown preview of the selected
 * note. Filter chips (Title only / In / Tag / Date) refine both modes.
 */
export class SonarModal extends Modal {
  private inputEl!: HTMLInputElement;
  private clearBtn!: HTMLButtonElement;
  private chipsEl!: HTMLElement;
  private listEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private statusEl!: HTMLElement;

  private groups: RowGroup[] = [];
  private rows: RowItem[] = [];
  private selected = 0;
  private raw = '';

  private titleOnly = false;
  private folderFilter: string | null = null;
  private tagFilter: string | null = null;
  private dateFilter: DateFilter | null = null;
  private typeFilter: string | null = null;

  private cancelQuery: (() => void) | null = null;
  private queryStart = 0;
  private previewGen = 0;
  private renderedPath: string | null = null;
  private readonly previewComponent = new Component();

  constructor(
    app: App,
    private readonly deps: ModalDeps,
  ) {
    super(app);
  }

  onOpen(): void {
    this.previewComponent.load();
    this.modalEl.addClass('sonar-modal');
    this.contentEl.addClass('sonar-modal__content');
    if (Platform.isPhone || window.innerWidth <= 600) this.modalEl.addClass('is-narrow');

    // Input row: search icon · [input + inline clear] · dedicated close ×.
    const inputRow = this.contentEl.createDiv({ cls: 'sonar-input-row' });
    setIcon(inputRow.createDiv({ cls: 'sonar-input-row__icon' }), 'search');

    const inputWrap = inputRow.createDiv({ cls: 'sonar-input-wrap' });
    this.inputEl = inputWrap.createEl('input', {
      cls: 'sonar-input',
      attr: { type: 'text', placeholder: 'Search your vault…', spellcheck: 'false' },
    });
    this.clearBtn = inputWrap.createEl('button', {
      cls: 'sonar-input-clear',
      text: 'Clear',
      attr: { 'aria-label': 'Clear search' },
    });
    this.clearBtn.addEventListener('click', () => {
      this.inputEl.value = '';
      this.inputEl.focus();
      this.onInput('');
    });

    const closeBtn = inputRow.createEl('button', {
      cls: 'sonar-icon-btn sonar-close',
      attr: { 'aria-label': 'Close' },
    });
    setIcon(closeBtn.createSpan({ cls: 'sonar-icon-btn__glyph' }), 'x');
    closeBtn.addEventListener('click', () => this.close());

    this.chipsEl = this.contentEl.createDiv({ cls: 'sonar-chips' });
    this.renderChips();

    const body = this.contentEl.createDiv({ cls: 'sonar-body' });
    this.listEl = body.createDiv({ cls: 'sonar-results' });
    this.previewEl = body.createDiv({ cls: 'sonar-preview' });

    const footer = this.contentEl.createDiv({ cls: 'sonar-footer' });
    footer.createSpan({
      cls: 'sonar-footer__hints',
      text: '↑↓ navigate · ↵ open · ⌘↵ new tab · esc close',
    });
    this.statusEl = footer.createSpan({ cls: 'sonar-footer__status' });

    this.inputEl.addEventListener('input', () => this.onInput(this.inputEl.value));
    this.inputEl.addEventListener('keydown', (e) => this.onKeydown(e));
    this.inputEl.focus();
    this.refresh();
  }

  onClose(): void {
    this.cancelQuery?.();
    this.previewComponent.unload();
    this.contentEl.empty();
  }

  // ---- chips ----

  private renderChips(): void {
    this.chipsEl.empty();
    this.makeChip('case-sensitive', 'Title only', this.titleOnly, () => {
      this.titleOnly = !this.titleOnly;
      this.renderChips();
      this.refresh();
    });
    this.makeChip(
      'folder',
      this.folderFilter ? `In: ${this.folderShort(this.folderFilter)}` : 'In',
      this.folderFilter !== null,
      () => this.pickFolder(),
      this.folderFilter !== null ? () => this.setFolder(null) : undefined,
    );
    this.makeChip(
      'tag',
      this.tagFilter ? `Tag: ${this.tagFilter}` : 'Tag',
      this.tagFilter !== null,
      () => this.pickTag(),
      this.tagFilter !== null ? () => this.setTag(null) : undefined,
    );
    this.makeChip(
      'calendar',
      this.dateFilter ? this.dateFilter.label : 'Date',
      this.dateFilter !== null,
      (e) => this.pickDate(e),
      this.dateFilter !== null ? () => this.setDate(null) : undefined,
    );
    this.makeChip(
      'file',
      this.typeFilter ? `Type: ${this.typeLabel(this.typeFilter)}` : 'Type',
      this.typeFilter !== null,
      (e) => this.pickType(e),
      this.typeFilter !== null ? () => this.setType(null) : undefined,
    );
  }

  private typeLabel(key: string): string {
    return TYPE_OPTIONS.find((t) => t.key === key)?.label ?? key;
  }

  private makeChip(
    icon: string,
    label: string,
    active: boolean,
    onClick: (e: MouseEvent) => void,
    onClear?: () => void,
  ): void {
    const chip = this.chipsEl.createEl('button', { cls: 'sonar-chip' });
    chip.toggleClass('is-active', active);
    setIcon(chip.createSpan({ cls: 'sonar-chip__icon' }), icon);
    chip.createSpan({ cls: 'sonar-chip__label', text: label });
    chip.addEventListener('click', (e) => onClick(e));
    if (onClear) {
      const x = chip.createSpan({ cls: 'sonar-chip__clear' });
      setIcon(x, 'x');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        onClear();
      });
    }
  }

  private folderShort(path: string): string {
    return path.length > 22 ? '…' + path.slice(-21) : path;
  }

  private pickFolder(): void {
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && f.path !== '/')
      .map((f) => f.path)
      .sort();
    new FilterSuggest(this.app, folders, 'Filter by folder…', (v) => this.setFolder(v)).open();
  }

  private pickTag(): void {
    new FilterSuggest(this.app, this.deps.service.allTags(), 'Filter by tag…', (v) =>
      this.setTag(v),
    ).open();
  }

  private pickDate(e: MouseEvent): void {
    const now = this.deps.now();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const presets: DateFilter[] = [
      { label: 'Today', minMtime: start.getTime() },
      { label: 'Past 7 days', minMtime: now - 7 * DAY },
      { label: 'Past 30 days', minMtime: now - 30 * DAY },
      { label: 'Past year', minMtime: now - 365 * DAY },
    ];
    const menu = new Menu();
    for (const preset of presets) {
      menu.addItem((item) =>
        item
          .setTitle(preset.label)
          .setChecked(this.dateFilter?.label === preset.label)
          .onClick(() => this.setDate(preset)),
      );
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('Any time').onClick(() => this.setDate(null)));
    menu.showAtMouseEvent(e);
  }

  private pickType(e: MouseEvent): void {
    const menu = new Menu();
    for (const opt of TYPE_OPTIONS) {
      menu.addItem((item) =>
        item
          .setTitle(opt.label)
          .setChecked(this.typeFilter === opt.key)
          .onClick(() => this.setType(opt.key)),
      );
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('Any type').onClick(() => this.setType(null)));
    menu.showAtMouseEvent(e);
  }

  private setType(value: string | null): void {
    this.typeFilter = value;
    this.renderChips();
    this.refresh();
    this.inputEl.focus();
  }

  /** A row passes the type filter when none is set, when it's an action row
   *  (create/exo), or when its extension/docType matches the chosen type. */
  private passesType(item: RowItem): boolean {
    if (!this.typeFilter || item.create || item.exo) return true;
    const opt = TYPE_OPTIONS.find((t) => t.key === this.typeFilter);
    if (!opt) return true;
    return opt.test(item.ext ?? extOf(item.path), item.docType);
  }

  private setFolder(value: string | null): void {
    this.folderFilter = value;
    this.renderChips();
    this.refresh();
    this.inputEl.focus();
  }

  private setTag(value: string | null): void {
    this.tagFilter = value;
    this.renderChips();
    this.refresh();
    this.inputEl.focus();
  }

  private setDate(value: DateFilter | null): void {
    this.dateFilter = value;
    this.renderChips();
    this.refresh();
    this.inputEl.focus();
  }

  private get pathFilters(): string[] {
    return this.folderFilter ? [this.folderFilter.toLowerCase()] : [];
  }

  private get tagFilters(): string[] {
    return this.tagFilter ? [this.tagFilter.toLowerCase()] : [];
  }

  // ---- query / browse ----

  private onInput(value: string): void {
    this.raw = value;
    this.clearBtn.toggleClass('is-visible', value.length > 0);
    this.refresh();
  }

  private refresh(): void {
    this.cancelQuery?.();
    const raw = this.raw.trim();
    if (!raw) {
      this.buildBrowse();
      return;
    }
    this.queryStart = performance.now();
    const prevPath = this.rows[this.selected]?.path;
    this.cancelQuery = this.deps.registry.query(
      raw,
      {
        // Over-fetch when a type filter is active: it's applied after fusion,
        // so we need a deeper pool to still fill the visible list.
        limit: this.typeFilter
          ? this.deps.settings.maxResults * 6
          : this.deps.settings.maxResults,
        now: this.deps.now(),
        titleOnly: this.titleOnly,
        pathFilters: this.pathFilters,
        tagFilters: this.tagFilters,
        minMtime: this.dateFilter?.minMtime,
      },
      (update) => {
        let items: RowItem[] = update.fused.map((r) => ({
          path: r.path,
          basename: r.basename,
          docType: r.docType,
          ext: r.ext ?? extOf(r.path),
          matched: r.matched,
          excerpt: r.excerpt,
        }));
        if (this.typeFilter) {
          items = items.filter((i) => this.passesType(i)).slice(0, this.deps.settings.maxResults);
        }
        if (items.length < 3) {
          const q = this.raw.trim();
          items.push({ path: '', basename: q, docType: 'md', matched: [], create: true });
          // When Exo is installed, offer to hand the query off to a fresh
          // default-model chat instead of the (few) local matches.
          if (this.exoPlugin()) {
            items.push({ path: '', basename: q, docType: 'md', matched: [], exo: true });
          }
        }
        this.groups = [{ items }];
        this.commitRows(prevPath);
      },
    );
  }

  private buildBrowse(): void {
    const recent = this.deps.service.recent(BROWSE_LIMIT, {
      pathFilters: this.pathFilters,
      tagFilters: this.tagFilters,
      minMtime: this.dateFilter?.minMtime,
    });
    const prevPath = this.rows[this.selected]?.path;
    this.groups = groupByRecency(recent, (r) => r.mtime, this.deps.now())
      .map((g) => ({
        label: g.label,
        items: g.items
          .map((r) => ({
            path: r.path,
            basename: r.basename,
            docType: r.docType,
            ext: extOf(r.path),
            matched: [],
          }))
          .filter((i) => this.passesType(i)),
      }))
      .filter((g) => g.items.length > 0);
    this.commitRows(prevPath);
  }

  private commitRows(prevPath?: string): void {
    this.rows = this.groups.flatMap((g) => g.items);
    const idx = prevPath ? this.rows.findIndex((r) => r.path === prevPath && !r.create) : -1;
    this.selected = idx >= 0 ? idx : 0;
    this.renderList();
    this.renderPreview();
    this.updateStatus();
  }

  // ---- rendering ----

  private renderList(): void {
    const holder = createDiv();
    let flatIndex = 0;
    for (const group of this.groups) {
      if (group.label) holder.createDiv({ cls: 'sonar-group', text: group.label });
      for (const item of group.items) {
        const i = flatIndex++;
        if (item.create) {
          const row = holder.createDiv({ cls: 'sonar-result sonar-result--create' });
          if (i === this.selected) row.addClass('is-selected');
          setIcon(row.createDiv({ cls: 'sonar-result__icon' }), 'file-plus');
          row.createDiv({ cls: 'sonar-result__main', text: `Create note: “${item.basename}”` });
          row.addEventListener('click', () => this.activate(i, false));
          continue;
        }
        if (item.exo) {
          const row = holder.createDiv({ cls: 'sonar-result sonar-result--exo' });
          if (i === this.selected) row.addClass('is-selected');
          setIcon(row.createDiv({ cls: 'sonar-result__icon' }), 'sparkles');
          row.createDiv({ cls: 'sonar-result__main', text: `Search with Exo: “${item.basename}”` });
          row.addEventListener('click', () => this.activate(i, false));
          continue;
        }
        renderResultRow(holder, item, {
          selected: i === this.selected,
          showScore: false,
          onClick: (mod) => this.activate(i, mod),
        });
      }
    }
    const fragment = document.createDocumentFragment();
    while (holder.firstChild) fragment.appendChild(holder.firstChild);
    this.listEl.empty();
    this.listEl.appendChild(fragment);
    this.scrollSelectedIntoView();
  }

  private renderPreview(): void {
    const item = this.rows[this.selected];
    if (!item || item.create || item.exo) {
      this.previewEl.empty();
      this.previewEl.addClass('is-empty');
      this.renderedPath = null;
      return;
    }
    if (item.path === this.renderedPath) return; // already showing this note
    this.renderedPath = item.path;
    this.previewEl.removeClass('is-empty');
    this.previewEl.empty();

    const header = this.previewEl.createDiv({ cls: 'sonar-preview__header' });
    const heading = header.createDiv({ cls: 'sonar-preview__heading' });
    heading.createDiv({ cls: 'sonar-preview__title', text: item.basename });
    const dir = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
    if (dir) heading.createDiv({ cls: 'sonar-preview__path', text: dir });

    const open = header.createEl('button', {
      cls: 'sonar-icon-btn',
      attr: { 'aria-label': 'Open note' },
    });
    setIcon(open.createSpan({ cls: 'sonar-icon-btn__glyph' }), 'external-link');
    open.addEventListener('click', () => this.openPath(item.path, false));

    const bodyEl = this.previewEl.createDiv({ cls: 'sonar-preview__body markdown-rendered' });
    const gen = ++this.previewGen;
    void this.deps.service.previewMarkdown(item.path).then((md) => {
      if (gen !== this.previewGen) return;
      bodyEl.empty();
      if (!md) {
        bodyEl.createEl('em', { cls: 'sonar-preview__empty', text: 'No preview available.' });
        return;
      }
      void MarkdownRenderer.render(this.app, md, bodyEl, item.path, this.previewComponent);
    });
  }

  private scrollSelectedIntoView(): void {
    this.listEl.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }

  // ---- interaction ----

  private onKeydown(e: KeyboardEvent): void {
    const count = this.rows.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (count > 0) {
        this.selected = (this.selected + 1) % count;
        this.renderList();
        this.renderPreview();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count > 0) {
        this.selected = (this.selected - 1 + count) % count;
        this.renderList();
        this.renderPreview();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.activate(this.selected, e.metaKey || e.ctrlKey);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  private activate(index: number, newTab: boolean): void {
    const item = this.rows[index];
    if (!item) return;
    if (item.create) {
      void this.createNote(item.basename);
      return;
    }
    if (item.exo) {
      this.askExo(item.basename);
      return;
    }
    this.openPath(item.path, newTab);
  }

  /** The Exo plugin instance, if installed, enabled, and exposing its public
   *  cross-plugin API. Null otherwise — callers must degrade gracefully. */
  private exoPlugin(): ExoApi | null {
    const plugins = (this.app as unknown as {
      plugins?: { plugins?: Record<string, unknown> };
    }).plugins?.plugins;
    const p = plugins?.['exo'] as ExoApi | undefined;
    return p && typeof p.askExo === 'function' ? p : null;
  }

  /** Hand the query off to a new default-model Exo chat, then dismiss. */
  private askExo(query: string): void {
    const exo = this.exoPlugin();
    if (!exo) {
      new Notice('Sonar: Exo is not available.');
      return;
    }
    void exo.askExo(query);
    this.close();
  }

  private openPath(path: string, newTab: boolean): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file);
      this.close();
    }
  }

  private async createNote(name: string): Promise<void> {
    if (!name) return;
    try {
      const parent = this.app.fileManager.getNewFileParent('');
      const path = `${parent.path ? parent.path + '/' : ''}${name}.md`;
      const file = await this.app.vault.create(path, '');
      await this.app.workspace.getLeaf(false).openFile(file);
      this.close();
    } catch (e) {
      new Notice(`Sonar: couldn't create note — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private updateStatus(): void {
    const status = this.deps.service.getStatus();
    if (!status.ready) {
      this.statusEl.setText(`Indexing… ${status.indexed}/${status.total}`);
      return;
    }
    if (!this.raw.trim()) {
      this.statusEl.setText('');
      return;
    }
    const realCount = this.rows.filter((r) => !r.create).length;
    if (this.deps.settings.showScoreDebug) {
      const ms = (performance.now() - this.queryStart).toFixed(1);
      this.statusEl.setText(`${realCount} results · ${ms} ms`);
    } else {
      this.statusEl.setText(`${realCount} results`);
    }
  }
}
