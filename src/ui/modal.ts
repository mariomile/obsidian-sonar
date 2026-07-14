import {
  type App,
  Component,
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
import type { BrowseSort, SonarSettings } from '../settings.ts';
import type { ProviderRegistry } from '../service/provider-registry.ts';
import type { SearchService } from '../service/search-service.ts';
import type { FileCatalog } from '../service/file-catalog.ts';
import { type RecentSortBy, resolveSortTime } from '../service/sort-time.ts';
import { renderResultRow } from './result-renderer.ts';
import { FilterSuggest } from './filter-suggest.ts';
import { ThumbnailRenderer } from './thumbnail.ts';
import { PreviewRenderer } from './preview.ts';
import { parseSigil } from './modes/parse.ts';
import type { Mode, OmniRow } from './modes/types.ts';

export interface ModalDeps {
  registry: ProviderRegistry;
  service: SearchService;
  fileCatalog: FileCatalog;
  settings: SonarSettings;
  now: () => number;
  /** Persists `settings` (e.g. after the Sort chip writes `browseSort`) — the
   *  one piece of modal state that survives a full Obsidian restart. */
  saveSettings: () => Promise<void>;
  /** Fresh mode instances for this modal session; wired in main.ts (Task 9).
   *  The factory receives the modal's close + askExo callbacks. */
  modes: (ctx: { close: () => void; askExo: (q: string) => void }) => Mode[];
}

/** A row backed by a real vault file — opens on Enter, shows a preview. */
interface FileRow {
  path: string;
  basename: string;
  docType: DocType;
  ext?: string;
  source?: string;
  matched: string[];
  excerpt?: { text: string; ranges: Array<[number, number]> };
}

/** A synthetic, actionable row — a command, capture, intent, or the
 *  "Create note"/"Search with Exo" affordances. Runs a closure on Enter,
 *  carries no file and shows no preview. */
interface OmniRowItem {
  omni: OmniRow;
}

type RowItem = FileRow | OmniRowItem;

/** Narrows a row to its synthetic (`omni`) variant. */
function isOmni(row: RowItem): row is OmniRowItem {
  return 'omni' in row;
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

/** Type keys the content index holds; others live only in the file catalog. */
const INDEXED_TYPE_KEYS = new Set(['note', 'pdf', 'image', 'html']);

type SortKey = BrowseSort;

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'created', label: 'Created' },
  { key: 'modified', label: 'Modified' },
  { key: 'viewed', label: 'Viewed' },
];

/** Lowercase file extension from a path, or '' if none. */
function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot + 1).toLowerCase() : '';
}

/** Last-used filters, kept module-scoped so they persist across reopens within
 *  a session (reset on a full app restart). */
const lastFilters: {
  titleOnly: boolean;
  folder: string | null;
  tag: string | null;
  date: DateFilter | null;
  type: string | null;
} = { titleOnly: false, folder: null, tag: null, date: null, type: null };

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

  private modeList: Mode[] = [];
  private mode: Mode | null = null; // null = search
  private stripped = '';
  private modeChipEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;

  private titleOnly = false;
  private folderFilter: string | null = null;
  private tagFilter: string | null = null;
  private dateFilter: DateFilter | null = null;
  private typeFilter: string | null = null;
  /** Unlike the filters above, persists across a full Obsidian restart via
   *  `settings.browseSort` rather than the module-scoped `lastFilters`. */
  private sortKey: SortKey;

  private cancelQuery: (() => void) | null = null;
  private queryStart = 0;
  private readonly previewComponent = new Component();
  private thumbnails!: ThumbnailRenderer;
  private preview!: PreviewRenderer;

  constructor(
    app: App,
    private readonly deps: ModalDeps,
  ) {
    super(app);
    this.titleOnly = lastFilters.titleOnly;
    this.folderFilter = lastFilters.folder;
    this.tagFilter = lastFilters.tag;
    this.dateFilter = lastFilters.date;
    this.typeFilter = lastFilters.type;
    this.sortKey = deps.settings.browseSort;
  }

  onOpen(): void {
    this.previewComponent.load();
    this.modalEl.addClass('sonar-modal');
    this.contentEl.addClass('sonar-modal__content');
    const isSheet = Platform.isPhone || window.innerWidth <= 600;
    if (isSheet) {
      this.modalEl.addClass('is-narrow');
      // Grab handle: the visual cue that the sheet is a drag-to-dismiss surface.
      this.contentEl.createDiv({ cls: 'sonar-sheet-grabber' });
    }

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
    this.thumbnails = new ThumbnailRenderer(
      this.app,
      this.deps.service,
      this.previewComponent,
      this.listEl,
    );
    this.preview = new PreviewRenderer(
      this.app,
      this.deps.service,
      this.previewEl,
      (path) => this.openPath(path, false),
    );

    const footer = this.contentEl.createDiv({ cls: 'sonar-footer' });
    footer.createSpan({
      cls: 'sonar-footer__hints',
      text: '↑↓ navigate · ↵ open · ⌘↵ new tab · ⇥ ask Exo · esc close',
    });
    // Right slot: shared between the result count (while querying) and the
    // grammar hint (in the empty-query browse state) — they never co-occur.
    const meta = footer.createDiv({ cls: 'sonar-footer__meta' });
    this.statusEl = meta.createSpan({ cls: 'sonar-footer__status' });
    this.hintEl = meta.createSpan({ cls: 'sonar-mode-hint' });
    this.hintEl.setText('> commands · + capture · ? ask Exo');

    // Mode list + the mode pill (inserted as inputRow's first child so it sits
    // left of the search icon and the input) + the empty-state grammar hint.
    this.modeList = this.deps.modes({ close: () => this.close(), askExo: (q) => this.askExo(q, true) });
    this.modeChipEl = createDiv({ cls: 'sonar-mode-chip' });
    inputRow.prepend(this.modeChipEl);
    this.modeChipEl.hide();

    this.inputEl.addEventListener('input', () => this.onInput(this.inputEl.value));
    this.inputEl.addEventListener('keydown', (e) => this.onKeydown(e));
    this.inputEl.focus();
    this.refresh();
    if (isSheet) this.setupSheetGestures();
  }

  /** Native-style drag-to-dismiss for the phone / narrow sheet: dragging the
   *  header (anything outside the scrolling results list) downward past a
   *  threshold slides the sheet off-screen and closes it; a shorter drag snaps
   *  back. The results list keeps its own vertical scroll. */
  private setupSheetGestures(): void {
    const settle = 'transform 220ms cubic-bezier(0.32, 0.72, 0, 1)';
    let startY = 0;
    let dy = 0;
    let dragging = false;

    const start = (e: TouchEvent): void => {
      const touch = e.touches[0];
      if (!touch || e.touches.length !== 1) return;
      if ((e.target as HTMLElement).closest('.sonar-results')) return; // let the list scroll
      startY = touch.clientY;
      dy = 0;
      dragging = true;
      this.modalEl.style.animation = 'none';
      this.modalEl.style.transition = 'none';
    };
    const move = (e: TouchEvent): void => {
      const touch = e.touches[0];
      if (!dragging || !touch) return;
      dy = touch.clientY - startY;
      if (dy <= 0) {
        this.modalEl.style.transform = '';
        return;
      }
      e.preventDefault();
      this.modalEl.style.transform = `translateY(${dy}px)`;
    };
    const end = (): void => {
      if (!dragging) return;
      dragging = false;
      this.modalEl.style.transition = settle;
      if (dy > 110) {
        this.modalEl.style.transform = 'translateY(100%)';
        window.setTimeout(() => this.close(), 200);
      } else {
        this.modalEl.style.transform = '';
      }
    };

    this.modalEl.addEventListener('touchstart', start, { passive: true });
    this.modalEl.addEventListener('touchmove', move, { passive: false });
    this.modalEl.addEventListener('touchend', end);
    this.modalEl.addEventListener('touchcancel', end);
  }

  onClose(): void {
    lastFilters.titleOnly = this.titleOnly;
    lastFilters.folder = this.folderFilter;
    lastFilters.tag = this.tagFilter;
    lastFilters.date = this.dateFilter;
    lastFilters.type = this.typeFilter;
    this.cancelQuery?.();
    this.thumbnails.dispose();
    this.preview.dispose();
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
    this.makeChip(
      'arrow-up-down',
      `Sort: ${this.sortLabel(this.sortKey)}`,
      this.sortKey !== 'relevance',
      (e) => this.pickSort(e),
    );
  }

  private typeLabel(key: string): string {
    return TYPE_OPTIONS.find((t) => t.key === key)?.label ?? key;
  }

  private sortLabel(key: SortKey): string {
    return SORT_OPTIONS.find((o) => o.key === key)?.label ?? key;
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

  private pickSort(e: MouseEvent): void {
    const menu = new Menu();
    for (const opt of SORT_OPTIONS) {
      menu.addItem((item) =>
        item
          .setTitle(opt.label)
          .setChecked(this.sortKey === opt.key)
          .onClick(() => this.setSort(opt.key)),
      );
    }
    menu.showAtMouseEvent(e);
  }

  private setSort(key: SortKey): void {
    this.sortKey = key;
    this.deps.settings.browseSort = key;
    void this.deps.saveSettings();
    this.renderChips();
    this.refresh();
    this.inputEl.focus();
  }

  /** A file row passes the type filter when none is set or when its
   *  extension/docType matches the chosen type. (Synthetic rows never reach
   *  this — they're appended after filtering.) */
  private passesType(item: FileRow): boolean {
    if (!this.typeFilter) return true;
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
    const { sigil, stripped } = parseSigil(value);
    const next = sigil === '' ? null : this.modeList.find((m) => m.sigil === sigil) ?? null;
    this.stripped = stripped;
    if (next !== this.mode) {
      this.mode = next;
      this.applyModeChrome();
    }
    this.refresh();
  }

  /** Show/hide the mode pill + swap the input placeholder for the active mode. */
  private applyModeChrome(): void {
    const chip = this.modeChipEl;
    if (!chip) return;
    if (!this.mode) {
      chip.hide();
      chip.removeAttribute('data-accent');
      this.inputEl.placeholder = 'Search your vault…';
      return;
    }
    chip.empty();
    chip.show();
    chip.setAttribute('data-accent', this.mode.accent);
    chip.createSpan({ cls: 'sonar-mode-chip__label', text: this.mode.chipLabel });
    this.inputEl.placeholder = this.mode.placeholder;
  }

  private refresh(): void {
    // Hide the hint while indexing so it can't share the footer's right slot
    // with the "Indexing…" status (they'd otherwise both show on empty query).
    this.hintEl?.toggle(!this.mode && !this.raw.trim() && this.deps.service.getStatus().ready);
    if (this.mode) {
      this.cancelQuery?.();
      const active = this.mode;
      void Promise.resolve(active.rows(this.stripped)).then((rows) => {
        if (this.mode !== active) return; // mode changed while awaiting
        this.groups = [{ items: rows.map((o) => this.omniItem(o)) }];
        this.commitRows();
      });
      return;
    }
    this.cancelQuery?.();
    const raw = this.raw.trim();
    if (!raw) {
      this.buildBrowse();
      return;
    }
    this.queryStart = performance.now();
    const prevPath = this.selectedPath();
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
        let files: FileRow[] = update.fused.map((r) => ({
          path: r.path,
          basename: r.basename,
          docType: r.docType,
          ext: r.ext ?? extOf(r.path),
          source: r.source,
          matched: r.matched,
          excerpt: r.excerpt,
        }));
        if (this.typeFilter) {
          files = files.filter((i) => this.passesType(i)).slice(0, this.deps.settings.maxResults);
        }
        if (this.sortKey !== 'relevance') {
          const sortBy = this.sortKey;
          files = [...files].sort(
            (a, b) => this.sortTimeFor(b.path, sortBy) - this.sortTimeFor(a.path, sortBy),
          );
        }
        const items: RowItem[] = [...files];
        if (items.length < 3) {
          const q = this.raw.trim();
          items.push(this.omniItem({
            key: '__create',
            icon: 'file-plus',
            main: `Create note: “${q}”`,
            run: () => void this.createNote(q),
          }));
          // When Exo is installed, offer to hand the query off to a fresh
          // default-model chat instead of the (few) local matches.
          if (this.exoPlugin()) {
            items.push(this.omniItem({
              key: '__exo',
              icon: 'sparkles',
              main: `Search with Exo: “${q}”`,
              run: () => this.askExo(q),
            }));
          }
        }
        this.groups = [{ items }];
        this.commitRows(prevPath);
      },
    );
  }

  /** 'relevance' has no meaning outside search ranking, so browse falls back
   *  to 'modified' — the pre-existing default order. */
  private get resolvedSort(): RecentSortBy {
    return this.sortKey === 'relevance' ? 'modified' : this.sortKey;
  }

  /** Sort timestamp for a typed-search result row. Rows there don't flow
   *  through `SearchService.recent()` (they come from the fused provider
   *  results), so this is a small separate live lookup against the vault
   *  and frecency, mirroring `SearchService.sortTimeFor`. */
  private sortTimeFor(path: string, sortBy: RecentSortBy): number {
    const file = this.app.vault.getAbstractFileByPath(path);
    const mtime = file instanceof TFile ? file.stat.mtime : 0;
    return resolveSortTime(sortBy, {
      mtime,
      ctime: file instanceof TFile ? file.stat.ctime : mtime,
      lastOpened: this.deps.service.frecency?.lastOpened(path),
    });
  }

  private buildBrowse(): void {
    // Catalog-only types (canvas/base/audio/video) aren't in the content index,
    // so browse them from the file catalog instead of recent index docs.
    if (this.typeFilter && !INDEXED_TYPE_KEYS.has(this.typeFilter)) {
      this.buildCatalogBrowse();
      return;
    }
    const recent = this.deps.service.recent(
      BROWSE_LIMIT,
      {
        pathFilters: this.pathFilters,
        tagFilters: this.tagFilters,
        minMtime: this.dateFilter?.minMtime,
      },
      this.resolvedSort,
    );
    const prevPath = this.selectedPath();
    this.groups = groupByRecency(recent, (r) => r.sortTime, this.deps.now())
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

  /** Empty-query browse for catalog-only file types (canvas/base/audio/video). */
  private buildCatalogBrowse(): void {
    const opt = TYPE_OPTIONS.find((t) => t.key === this.typeFilter);
    const recs = this.deps.fileCatalog.recent(
      BROWSE_LIMIT,
      (r) => (opt ? opt.test(r.ext, 'md') : true),
      this.resolvedSort,
    );
    const prevPath = this.selectedPath();
    this.groups = groupByRecency(recs, (r) => r.sortTime, this.deps.now()).map((g) => ({
      label: g.label,
      items: g.items.map((r) => ({
        path: r.path,
        basename: r.basename,
        docType: 'md' as DocType,
        ext: r.ext,
        matched: [],
      })),
    }));
    this.commitRows(prevPath);
  }

  private commitRows(prevPath?: string): void {
    this.rows = this.groups.flatMap((g) => g.items);
    const idx = prevPath
      ? this.rows.findIndex((r) => !isOmni(r) && r.path === prevPath)
      : -1;
    this.selected = idx >= 0 ? idx : 0;
    this.renderList();
    this.renderPreview();
    this.updateStatus();
  }

  private omniItem(o: OmniRow): OmniRowItem {
    return { omni: o };
  }

  /** The path of the currently-selected row, or undefined when it's a
   *  synthetic (omni) row — used to preserve selection across a refresh. */
  private selectedPath(): string | undefined {
    const r = this.rows[this.selected];
    return r && !isOmni(r) ? r.path : undefined;
  }

  // ---- rendering ----

  private renderList(): void {
    // Rows are rebuilt on every keystroke; drop stale observations so discarded
    // rows don't pin nodes in the thumbnail observer (the cache is preserved).
    this.thumbnails.resetObservations();
    const holder = createDiv();
    let flatIndex = 0;
    for (const group of this.groups) {
      if (group.label) holder.createDiv({ cls: 'sonar-group', text: group.label });
      for (const item of group.items) {
        const i = flatIndex++;
        if (isOmni(item)) {
          const o = item.omni;
          const row = holder.createDiv({ cls: 'sonar-result sonar-result--omni' });
          if (o.disabled) row.addClass('is-disabled');
          if (i === this.selected) row.addClass('is-selected');
          // Search-mode omni rows are the "Create note" / "Search with Exo"
          // affordances (no active mode) — styled as muted actions.
          if (!this.mode) row.addClass('sonar-result--affordance');
          const thumb = row.createDiv({ cls: 'sonar-result__thumb' });
          if (this.mode) thumb.setAttribute('data-accent', this.mode.accent);
          setIcon(thumb.createDiv({ cls: 'sonar-thumb__icon' }), o.icon);
          const main = row.createDiv({ cls: 'sonar-result__main' });
          main.createDiv({ cls: 'sonar-result__title', text: o.main });
          if (o.sub) main.createDiv({ cls: 'sonar-result__sub', text: o.sub });
          if (o.aux) row.createDiv({ cls: 'sonar-result__aux', text: o.aux });
          if (!o.disabled) row.addEventListener('click', () => this.activate(i, false));
          continue;
        }
        renderResultRow(holder, item, {
          selected: i === this.selected,
          showScore: this.deps.settings.showScoreDebug,
          onClick: (mod) => this.activate(i, mod),
          onContext: (e) => this.openContextMenu(item, e),
          thumbnails: this.thumbnails,
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
    this.preview.render(item && !isOmni(item) ? item : null);
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
    } else if (e.key === 'Tab') {
      // Shortcut: hand whatever's typed to Exo and execute. Empty input drops
      // into intent mode so the next keystrokes compose the request.
      e.preventDefault();
      const q = this.stripped.trim();
      if (q) this.askExo(q, true);
      else this.enterMode('?');
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  /** Programmatically switch the input into a sigil mode (e.g. Tab → intent). */
  private enterMode(sigil: '>' | '+' | '?'): void {
    this.inputEl.value = `${sigil} `;
    this.onInput(this.inputEl.value);
  }

  private activate(index: number, newTab: boolean): void {
    const item = this.rows[index];
    if (!item) return;
    if (isOmni(item)) {
      if (!item.omni.disabled) void item.omni.run(newTab);
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

  /** Hand the query off to a new default-model Exo chat, then dismiss.
   *  `autoSend` controls whether Exo executes the query immediately
   *  (intent mode = execution) or merely pre-fills it (legacy search
   *  handoff, where the user may still want to edit before sending). */
  private askExo(query: string, autoSend = false): void {
    const exo = this.exoPlugin();
    if (!exo) {
      new Notice('Sonar: Exo is not available.');
      return;
    }
    void exo.askExo(query, autoSend);
    this.close();
  }

  private openPath(path: string, newTab: boolean): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file);
      this.close();
    }
  }

  /** Right-click actions on a result row. */
  private openContextMenu(item: RowItem, e: MouseEvent): void {
    if (isOmni(item)) return;
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) return;
    const open = (leaf: 'tab' | 'split' | false): void => {
      void this.app.workspace.getLeaf(leaf).openFile(file);
      this.close();
    };
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('Open').setIcon('file').onClick(() => open(false)));
    menu.addItem((i) => i.setTitle('Open in new tab').setIcon('plus').onClick(() => open('tab')));
    menu.addItem((i) =>
      i.setTitle('Open to the right').setIcon('separator-vertical').onClick(() => open('split')),
    );
    menu.addSeparator();
    menu.addItem((i) =>
      i.setTitle('Reveal in file explorer').setIcon('folder').onClick(() => this.reveal(file)),
    );
    menu.addItem((i) =>
      i
        .setTitle('Copy path')
        .setIcon('copy')
        .onClick(() => {
          void navigator.clipboard.writeText(item.path);
          new Notice('Sonar: path copied');
        }),
    );
    menu.showAtMouseEvent(e);
  }

  /** Reveal a file in the core file-explorer (best-effort; internal API). */
  private reveal(file: TFile): void {
    const fe = (
      this.app as unknown as {
        internalPlugins?: {
          getEnabledPluginById?: (id: string) => { revealInFolder?: (f: TFile) => void } | null;
        };
      }
    ).internalPlugins?.getEnabledPluginById?.('file-explorer');
    if (fe?.revealInFolder) {
      fe.revealInFolder(file);
      this.close();
    } else {
      new Notice('Sonar: file explorer not available');
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
      const skipped = status.skipped > 0 ? ` · ${status.skipped} skipped` : '';
      this.statusEl.setText(`Indexing… ${status.indexed}/${status.total}${skipped}`);
      return;
    }
    if (!this.raw.trim()) {
      this.statusEl.setText('');
      return;
    }
    const realCount = this.rows.filter((r) => !isOmni(r)).length;
    if (this.deps.settings.showScoreDebug) {
      const ms = (performance.now() - this.queryStart).toFixed(1);
      this.statusEl.setText(`${realCount} results · ${ms} ms`);
    } else {
      this.statusEl.setText(`${realCount} results`);
    }
  }
}
