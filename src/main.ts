import { Platform, Plugin, TFile } from 'obsidian';
import { parseSettings, type SonarSettings } from './settings.ts';
import { SearchService } from './service/search-service.ts';
import { Extractor } from './service/extractor.ts';
import { ProviderRegistry } from './service/provider-registry.ts';
import { KeywordProvider } from './service/keyword-provider.ts';
import { FileCatalog } from './service/file-catalog.ts';
import { FileFinderProvider } from './service/file-finder-provider.ts';
import { HttpServer } from './service/http-server.ts';
import { SonarSettingTab } from './settings-tab.ts';
import { SonarModal } from './ui/modal.ts';

export default class SonarPlugin extends Plugin {
  settings!: SonarSettings;
  service!: SearchService;
  private registry!: ProviderRegistry;
  private extractor!: Extractor;
  private fileCatalog!: FileCatalog;
  private httpServer: HttpServer | null = null;

  async onload(): Promise<void> {
    this.settings = parseSettings(await this.loadData());

    this.service = new SearchService(this.app, this.settings, this.manifest.dir);
    this.extractor = new Extractor(this.app, this.settings, this.service.index, () =>
      this.service.scheduleSave(),
    );
    this.service.extractor = this.extractor;

    this.registry = new ProviderRegistry();
    this.registry.register(new KeywordProvider(this.service));

    this.fileCatalog = new FileCatalog(this.app);
    // Register AFTER KeywordProvider so the keyword list is the first list into
    // RRF: when the same path matches by content AND by name, the deduped item
    // kept is the keyword result (which carries the excerpt). Attention point #1.
    this.registry.register(new FileFinderProvider(this.fileCatalog));

    this.addCommand({
      id: 'open-search',
      name: 'Search vault',
      callback: () => this.openModal(),
    });
    this.addRibbonIcon('search', 'Sonar: search vault', () => this.openModal());
    this.addSettingTab(new SonarSettingTab(this.app, this));

    this.service.start((ref) => this.registerEvent(ref));

    // The file catalog powers the universal file finder over every file type.
    // It's rebuilt from getFiles() at layout-ready and kept fresh incrementally.
    this.app.workspace.onLayoutReady(() => this.fileCatalog.build());
    this.registerEvent(
      this.app.vault.on('create', (f) => {
        if (f instanceof TFile) this.fileCatalog.add(f);
      }),
    );
    this.registerEvent(this.app.vault.on('delete', (f) => this.fileCatalog.remove(f.path)));
    this.registerEvent(
      this.app.vault.on('rename', (f, oldPath) => {
        if (f instanceof TFile) this.fileCatalog.rename(oldPath, f);
      }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (f instanceof TFile) this.fileCatalog.add(f); // refresh mtime
      }),
    );

    this.refreshHttp();
  }

  onunload(): void {
    this.httpServer?.stop();
    this.service.dispose();
  }

  private openModal(): void {
    new SonarModal(this.app, {
      registry: this.registry,
      service: this.service,
      settings: this.settings,
      now: () => Date.now(),
    }).open();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Start/stop/restart the HTTP server to match the current settings. */
  refreshHttp(): void {
    this.httpServer?.stop();
    this.httpServer = null;
    if (Platform.isDesktopApp && this.settings.httpEnabled) {
      this.httpServer = new HttpServer(this.service, this.settings.httpPort);
      this.httpServer.start();
    }
  }

  httpStatusText(): { text: string; error: boolean } | null {
    if (!Platform.isDesktopApp) return null;
    const status = this.httpServer?.status ?? { state: 'stopped' as const };
    switch (status.state) {
      case 'listening':
        return { text: `Listening on 127.0.0.1:${status.port}`, error: false };
      case 'error':
        return { text: status.message, error: true };
      default:
        return this.settings.httpEnabled ? { text: 'Starting…', error: false } : null;
    }
  }
}
