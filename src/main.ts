import { Platform, Plugin, TFile } from 'obsidian';
import { parseSettings, type SonarSettings } from './settings.ts';
import { SearchService } from './service/search-service.ts';
import { Extractor } from './service/extractor.ts';
import { ProviderRegistry } from './service/provider-registry.ts';
import { KeywordProvider } from './service/keyword-provider.ts';
import { FileCatalog } from './service/file-catalog.ts';
import { FileFinderProvider } from './service/file-finder-provider.ts';
import { FrecencyTracker } from './service/frecency.ts';
import { createBearerToken, HttpServer } from './service/http-server.ts';
import { SonarSettingTab } from './settings-tab.ts';
import { SonarModal } from './ui/modal.ts';
import { ActionCatalog, type SonarActionInfo } from './service/action-catalog.ts';
import { CommandMode } from './ui/modes/command-mode.ts';
import { CaptureMode } from './ui/modes/capture-mode.ts';
import { IntentMode } from './ui/modes/intent-mode.ts';
import { appendCapture } from './service/capture.ts';

export default class SonarPlugin extends Plugin {
  settings!: SonarSettings;
  service!: SearchService;
  private registry!: ProviderRegistry;
  private extractor!: Extractor;
  private fileCatalog!: FileCatalog;
  private frecency!: FrecencyTracker;
  private catalog!: ActionCatalog;
  private httpServer: HttpServer | null = null;

  async onload(): Promise<void> {
    this.settings = parseSettings(await this.loadData());

    this.service = new SearchService(this.app, this.settings, this.manifest.dir);
    this.extractor = new Extractor(
      this.app,
      this.settings,
      this.service.index,
      () => this.service.scheduleSave(),
      this.manifest.dir,
    );
    this.service.extractor = this.extractor;
    void this.extractor.load();

    this.frecency = new FrecencyTracker(this.app, this.manifest.dir);
    this.service.frecency = this.frecency;
    void this.frecency.load();

    this.registry = new ProviderRegistry();
    this.registry.register(new KeywordProvider(this.service));

    this.fileCatalog = new FileCatalog(this.app);
    // Register AFTER KeywordProvider so the keyword list is the first list into
    // RRF: when the same path matches by content AND by name, the deduped item
    // kept is the keyword result (which carries the excerpt). Attention point #1.
    this.registry.register(new FileFinderProvider(this.fileCatalog));

    // `app.commands` isn't in the public typings; cast it locally.
    const commands = (this.app as unknown as {
      commands: {
        listCommands(): Array<{ id: string; name: string }>;
        executeCommandById(id: string): void;
      };
    }).commands;
    this.catalog = new ActionCatalog(
      () => commands.listCommands().map((c) => ({ id: c.id, name: c.name })),
      (id) => {
        commands.executeCommandById(id);
      },
      (id) => this.hotkeyLabel(id),
    );
    // Command availability changes when plugins toggle; drop the cache then.
    this.registerEvent(this.app.workspace.on('layout-change', () => this.catalog.invalidate()));

    this.addCommand({
      id: 'open-search',
      name: 'Search vault',
      callback: () => this.openModal(),
    });
    this.addRibbonIcon('search', 'Sonar: search vault', () => this.openModal());
    this.addSettingTab(new SonarSettingTab(this.app, this));

    this.service.start((ref) => this.registerEvent(ref));
    this.frecency.start((ref) => this.registerEvent(ref), () => Date.now());

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
    this.frecency?.dispose();
    this.extractor?.dispose();
  }

  private openModal(): void {
    new SonarModal(this.app, {
      registry: this.registry,
      service: this.service,
      fileCatalog: this.fileCatalog,
      settings: this.settings,
      now: () => Date.now(),
      modes: ({ close, askExo }) => [
        new CommandMode(this.catalog, this.frecency, () => Date.now(), close),
        new CaptureMode((text) => appendCapture(this.app, text, Date.now()), close),
        new IntentMode(() => this.exoAvailable(), (q) => askExo(q)),
      ],
    }).open();
  }

  /** First hotkey label for a command id, or undefined. `hotkeyManager` isn't
   *  in the public typings, so it's cast locally. */
  private hotkeyLabel(id: string): string | undefined {
    const hk = (this.app as unknown as {
      hotkeyManager?: { getHotkeys?: (id: string) => Array<{ modifiers: string[]; key: string }> };
    }).hotkeyManager?.getHotkeys?.(id)?.[0];
    if (!hk) return undefined;
    return [...hk.modifiers, hk.key].join('+');
  }

  /** Whether the Exo plugin is installed and exposes its cross-plugin API. */
  private exoAvailable(): boolean {
    const p = (this.app as unknown as { plugins?: { plugins?: Record<string, { askExo?: unknown }> } })
      .plugins?.plugins?.['exo'];
    return typeof p?.askExo === 'function';
  }

  /** Read-only action catalog for cross-plugin consumers (Exo's tool-surface). */
  getActions(): SonarActionInfo[] {
    return this.catalog.info();
  }

  /** Execute an action by id. Destructive actions are flagged so the caller can
   *  gate them behind a confirmation. */
  async runAction(id: string): Promise<{ ok: boolean; destructive: boolean }> {
    return this.catalog.run(id);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Start/stop/restart the HTTP server to match the current settings. */
  refreshHttp(): void {
    this.httpServer?.stop();
    this.httpServer = null;
    if (Platform.isDesktopApp && this.settings.httpEnabled && this.settings.httpTokenHash) {
      this.httpServer = new HttpServer(
        this.service,
        this.settings.httpPort,
        this.settings.httpTokenHash,
      );
      this.httpServer.start();
    }
  }

  /** Rotate the API credential, persisting only its SHA-256 hash. */
  async rotateHttpToken(): Promise<string> {
    const { token, hash } = createBearerToken();
    this.settings.httpTokenHash = hash;
    await this.saveSettings();
    this.refreshHttp();
    return token;
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
        if (this.settings.httpEnabled && !this.settings.httpTokenHash) {
          return { text: 'Generate an access token before the HTTP API can start.', error: true };
        }
        return this.settings.httpEnabled ? { text: 'Starting…', error: false } : null;
    }
  }
}
