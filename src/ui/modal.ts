import { type App, Modal, Notice, Platform, TFile, TFolder, setIcon } from 'obsidian';
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
  matched: string[];
  excerpt?: { text: string; ranges: Array<[number, number]> };
  /** Present for the synthetic "create note" row. */
  create?: boolean;
}

interface RowGroup {
  label?: string;
  items: RowItem[];
}

const BROWSE_LIMIT = 60;

/**
 * The central search modal — a two-pane, Notion-style quick-find. Empty query
 * shows recent notes grouped by recency (Today/Yesterday/…); typing switches to
 * a flat relevance-ranked list. The right pane previews the selected note.
 * Filter chips (Title only / In folder / Tag) refine both modes.
 */
export class SonarModal extends Modal {
  private inputEl!: HTMLInputElement;
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

  private cancelQuery: (() => void) | null = null;
  private queryStart = 0;
  private previewGen = 0;
  private readonly previewCache = new Map<string, string>();

  constructor(
    app: App,
    private readonly deps: ModalDeps,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('sonar-modal');
    this.contentEl.addClass('sonar-modal__content');
    // Single-column, full-screen layout on phones / narrow windows.
    if (Platform.isPhone || window.innerWidth <= 600) this.modalEl.addClass('is-narrow');

    // Input row.
    const inputRow = this.contentEl.createDiv({ cls: 'sonar-input-row' });
    setIcon(inputRow.createDiv({ cls: 'sonar-input-row__icon' }), 'search');
    this.inputEl = inputRow.createEl('input', {
      cls: 'sonar-input',
      attr: { type: 'text', placeholder: 'Search or ask a question in Marioverse…', spellcheck: 'false' },
    });
    const clearBtn = inputRow.createEl('button', { cls: 'sonar-icon-btn', attr: { 'aria-label': 'Clear' } });
    setIcon(clearBtn, 'x');
    clearBtn.addEventListener('click', () => {
      this.inputEl.value = '';
      this.inputEl.focus();
      this.onInput('');
    });

    // Filter chips.
    this.chipsEl = this.contentEl.createDiv({ cls: 'sonar-chips' });
    this.renderChips();

    // Body: results (left) + preview (right).
    const body = this.contentEl.createDiv({ cls: 'sonar-body' });
    this.listEl = body.createDiv({ cls: 'sonar-results' });
    this.previewEl = body.createDiv({ cls: 'sonar-preview' });

    // Footer.
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
      this.folderFilter ? `In: ${this.folderFilter}` : 'In',
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
  }

  private makeChip(
    icon: string,
    label: string,
    active: boolean,
    onClick: () => void,
    onClear?: () => void,
  ): void {
    const chip = this.chipsEl.createEl('button', { cls: 'sonar-chip' });
    chip.toggleClass('is-active', active);
    setIcon(chip.createSpan({ cls: 'sonar-chip__icon' }), icon);
    chip.createSpan({ cls: 'sonar-chip__label', text: label });
    chip.addEventListener('click', onClick);
    if (onClear) {
      const x = chip.createSpan({ cls: 'sonar-chip__clear' });
      setIcon(x, 'x');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        onClear();
      });
    }
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

  private get pathFilters(): string[] {
    return this.folderFilter ? [this.folderFilter.toLowerCase()] : [];
  }

  private get tagFilters(): string[] {
    return this.tagFilter ? [this.tagFilter.toLowerCase()] : [];
  }

  // ---- query / browse ----

  private onInput(value: string): void {
    this.raw = value;
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
        limit: this.deps.settings.maxResults,
        now: this.deps.now(),
        titleOnly: this.titleOnly,
        pathFilters: this.pathFilters,
        tagFilters: this.tagFilters,
      },
      (update) => {
        const items: RowItem[] = update.fused.map((r) => ({
          path: r.path,
          basename: r.basename,
          docType: r.docType,
          matched: r.matched,
          excerpt: r.excerpt,
        }));
        if (items.length < 3) {
          items.push({ path: '', basename: this.raw.trim(), docType: 'md', matched: [], create: true });
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
    });
    const prevPath = this.rows[this.selected]?.path;
    this.groups = groupByRecency(recent, (r) => r.mtime, this.deps.now()).map((g) => ({
      label: g.label,
      items: g.items.map((r) => ({
        path: r.path,
        basename: r.basename,
        docType: r.docType,
        matched: [],
      })),
    }));
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
    this.previewEl.empty();
    if (!item || item.create) {
      this.previewEl.addClass('is-empty');
      return;
    }
    this.previewEl.removeClass('is-empty');

    const header = this.previewEl.createDiv({ cls: 'sonar-preview__header' });
    header.createDiv({ cls: 'sonar-preview__title', text: item.basename });
    const open = header.createEl('button', { cls: 'sonar-icon-btn', attr: { 'aria-label': 'Open' } });
    setIcon(open, 'arrow-up-right');
    open.addEventListener('click', () => this.openPath(item.path, false));

    const dir = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
    if (dir) this.previewEl.createDiv({ cls: 'sonar-preview__path', text: dir });

    const bodyEl = this.previewEl.createDiv({ cls: 'sonar-preview__body' });
    const cached = this.previewCache.get(item.path);
    if (cached !== undefined) {
      bodyEl.setText(cached);
    } else {
      bodyEl.setText('');
      const gen = ++this.previewGen;
      void this.deps.service.previewText(item.path).then((text) => {
        const clean = (text ?? '').replace(/\s+/g, ' ').trim();
        this.previewCache.set(item.path, clean);
        if (gen === this.previewGen) bodyEl.setText(clean);
      });
    }
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
    this.openPath(item.path, newTab);
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
