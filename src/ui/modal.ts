import { type App, Modal, Notice, TFile, setIcon } from 'obsidian';
import type { ProviderResult } from '../types.ts';
import type { SonarSettings } from '../settings.ts';
import type { ProviderRegistry } from '../service/provider-registry.ts';
import type { SearchService } from '../service/search-service.ts';
import { renderResultRow } from './result-renderer.ts';

export interface ModalDeps {
  registry: ProviderRegistry;
  service: SearchService;
  settings: SonarSettings;
  now: () => number;
}

/**
 * The central search modal. Runs the query on every keystroke (coalesced to one
 * animation frame — the engine is fast enough that no debounce is needed),
 * streams provider results in, and supports keyboard navigation. Extends the
 * base Modal (not SuggestModal) so it can render sections, a footer, and fill
 * excerpts asynchronously.
 */
export class SonarModal extends Modal {
  private inputEl!: HTMLInputElement;
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;

  private results: ProviderResult[] = [];
  private selected = 0;
  private raw = '';
  private cancelQuery: (() => void) | null = null;
  private queryStart = 0;

  constructor(
    app: App,
    private readonly deps: ModalDeps,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('sonar-modal');
    this.contentEl.addClass('sonar-modal__content');

    const inputRow = this.contentEl.createDiv({ cls: 'sonar-input-row' });
    const searchIcon = inputRow.createDiv({ cls: 'sonar-input-row__icon' });
    setIcon(searchIcon, 'search');
    this.inputEl = inputRow.createEl('input', {
      cls: 'sonar-input',
      attr: { type: 'text', placeholder: 'Search your vault…', spellcheck: 'false' },
    });
    const clearBtn = inputRow.createEl('button', { cls: 'sonar-input-row__clear' });
    setIcon(clearBtn, 'x');
    clearBtn.addEventListener('click', () => {
      this.inputEl.value = '';
      this.inputEl.focus();
      this.onInput('');
    });

    this.listEl = this.contentEl.createDiv({ cls: 'sonar-results' });

    const footer = this.contentEl.createDiv({ cls: 'sonar-footer' });
    footer.createSpan({
      cls: 'sonar-footer__hints',
      text: '↑↓ navigate · ↵ open · ⌘↵ new tab · esc close',
    });
    this.statusEl = footer.createSpan({ cls: 'sonar-footer__status' });

    this.inputEl.addEventListener('input', () => this.onInput(this.inputEl.value));
    this.inputEl.addEventListener('keydown', (e) => this.onKeydown(e));
    this.updateStatus();
    this.inputEl.focus();
  }

  onClose(): void {
    this.cancelQuery?.();
    this.contentEl.empty();
  }

  private onInput(value: string): void {
    // Input events are already discrete and the engine is <30ms, so run the
    // query directly — no debounce, no rAF (which pauses when unfocused).
    this.raw = value;
    this.runQuery();
  }

  private runQuery(): void {
    this.cancelQuery?.();
    const raw = this.raw.trim();
    if (!raw) {
      this.results = [];
      this.selected = 0;
      this.renderList();
      this.updateStatus();
      return;
    }
    this.queryStart = performance.now();
    const prevSelectedPath = this.results[this.selected]?.path;
    this.cancelQuery = this.deps.registry.query(
      raw,
      { limit: this.deps.settings.maxResults, now: this.deps.now() },
      (update) => {
        this.results = update.fused;
        // Preserve selection by path across re-ranks when possible.
        const idx = this.results.findIndex((r) => r.path === prevSelectedPath);
        this.selected = idx >= 0 ? idx : 0;
        this.renderList();
        this.updateStatus();
      },
    );
  }

  private get hasCreateRow(): boolean {
    return this.raw.trim().length > 0 && this.results.length < 3;
  }

  private get rowCount(): number {
    return this.results.length + (this.hasCreateRow ? 1 : 0);
  }

  private renderList(): void {
    const fragment = document.createDocumentFragment();
    const holder = createDiv();
    this.results.forEach((result, i) => {
      renderResultRow(holder, result, {
        selected: i === this.selected,
        showScore: this.deps.settings.showScoreDebug,
        onClick: (modKey) => {
          this.selected = i;
          this.activateSelection(modKey);
        },
      });
    });
    if (this.hasCreateRow) {
      const createIdx = this.results.length;
      const row = holder.createDiv({ cls: 'sonar-result sonar-result--create' });
      if (this.selected === createIdx) row.addClass('is-selected');
      const icon = row.createDiv({ cls: 'sonar-result__icon' });
      setIcon(icon, 'file-plus');
      row.createDiv({ cls: 'sonar-result__main', text: `Create note: “${this.raw.trim()}”` });
      row.addEventListener('click', () => {
        this.selected = createIdx;
        this.activateSelection(false);
      });
    }
    while (holder.firstChild) fragment.appendChild(holder.firstChild);
    this.listEl.empty();
    this.listEl.appendChild(fragment);
    this.scrollSelectedIntoView();
  }

  private scrollSelectedIntoView(): void {
    const el = this.listEl.children[this.selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }

  private onKeydown(e: KeyboardEvent): void {
    const count = this.rowCount;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (count > 0) {
        this.selected = (this.selected + 1) % count;
        this.renderList();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count > 0) {
        this.selected = (this.selected - 1 + count) % count;
        this.renderList();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.activateSelection(e.metaKey || e.ctrlKey);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  private activateSelection(newTab: boolean): void {
    if (this.hasCreateRow && this.selected === this.results.length) {
      void this.createNote();
      return;
    }
    const result = this.results[this.selected];
    if (!result) return;
    const file = this.app.vault.getAbstractFileByPath(result.path);
    if (file instanceof TFile) {
      void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file);
      this.close();
    }
  }

  private async createNote(): Promise<void> {
    const name = this.raw.trim();
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
    if (this.deps.settings.showScoreDebug && this.raw.trim()) {
      const ms = (performance.now() - this.queryStart).toFixed(1);
      this.statusEl.setText(`${this.results.length} results · ${ms} ms`);
    } else {
      this.statusEl.setText(this.raw.trim() ? `${this.results.length} results` : '');
    }
  }
}
