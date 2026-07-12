import { type App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type SonarPlugin from './main.ts';

export class SonarSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: SonarPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl).setName('Results').setHeading();

    new Setting(containerEl)
      .setName('Max results')
      .setDesc('How many results the search modal shows (1–50).')
      .addText((t) =>
        t.setValue(String(s.maxResults)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n > 0 && n <= 50) {
            s.maxResults = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Show score (debug)')
      .setDesc('Display per-result scores and query timing, for tuning ranking.')
      .addToggle((t) =>
        t.setValue(s.showScoreDebug).onChange(async (v) => {
          s.showScoreDebug = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Body fuzzy matching')
      .setDesc('When typo-tolerant fuzzy runs over note bodies. "On when sparse" is the default.')
      .addDropdown((d) =>
        d
          .addOption('off', 'Off')
          .addOption('on-sparse', 'On when sparse')
          .addOption('always', 'Always')
          .setValue(s.bodyFuzzy)
          .onChange(async (v) => {
            s.bodyFuzzy = v as 'off' | 'on-sparse' | 'always';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName('Attachments').setHeading();

    new Setting(containerEl)
      .setName('Index PDFs')
      .setDesc('Index text extracted from PDFs (requires the Text Extractor plugin).')
      .addToggle((t) =>
        t.setValue(s.indexPdf).onChange(async (v) => {
          s.indexPdf = v;
          await this.plugin.saveSettings();
          if (v) void this.plugin.service.extractor?.run();
        }),
      );

    new Setting(containerEl)
      .setName('Index images (OCR)')
      .setDesc('Index OCR text from images (requires the Text Extractor plugin).')
      .addToggle((t) =>
        t.setValue(s.indexImages).onChange(async (v) => {
          s.indexImages = v;
          await this.plugin.saveSettings();
          if (v) void this.plugin.service.extractor?.run();
        }),
      );

    new Setting(containerEl)
      .setName('Index HTML content')
      .setDesc('Search inside .html files (e.g. generated artifacts). Rebuild the index after changing.')
      .addToggle((t) =>
        t.setValue(s.indexHtml).onChange(async (v) => {
          s.indexHtml = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Max attachment size (MB)')
      .setDesc('Skip attachments larger than this.')
      .addText((t) =>
        t.setValue(String(s.maxAttachmentMB)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            s.maxAttachmentMB = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl).setName('HTTP API').setHeading();

    new Setting(containerEl)
      .setName('Enable HTTP search API')
      .setDesc('Authenticated GET /search endpoint on localhost (desktop only).')
      .addToggle((t) =>
        t.setValue(s.httpEnabled).onChange(async (v) => {
          s.httpEnabled = v;
          await this.plugin.saveSettings();
          this.plugin.refreshHttp();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('HTTP access token')
      .setDesc(
        s.httpTokenHash
          ? 'Configured. Regenerating invalidates the previous token; only its SHA-256 hash is stored.'
          : 'Required before the API starts. The raw token is copied once and is never stored in the vault.',
      )
      .addButton((b) =>
        b.setButtonText(s.httpTokenHash ? 'Regenerate and copy' : 'Generate and copy').onClick(async () => {
          const token = await this.plugin.rotateHttpToken();
          await navigator.clipboard.writeText(token);
          new Notice('Sonar: access token copied. Store it in your local client now.');
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('HTTP port')
      .setDesc('Default 51361 (Omnisearch’s port, for drop-in compatibility).')
      .addText((t) =>
        t.setValue(String(s.httpPort)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n > 0 && n < 65536) {
            s.httpPort = n;
            await this.plugin.saveSettings();
            this.plugin.refreshHttp();
          }
        }),
      );

    const httpStatus = this.plugin.httpStatusText();
    if (httpStatus) {
      const statusEl = containerEl.createDiv({ cls: 'sonar-http-status', text: httpStatus.text });
      statusEl.toggleClass('is-error', httpStatus.error);
      statusEl.toggleClass('is-ok', !httpStatus.error);
    }

    new Setting(containerEl).setName('Index').setHeading();

    new Setting(containerEl)
      .setName('Rebuild index')
      .setDesc('Discard and rebuild the search index from scratch.')
      .addButton((b) =>
        b.setButtonText('Rebuild').onClick(async () => {
          b.setDisabled(true).setButtonText('Rebuilding…');
          await this.plugin.service.rebuild();
          b.setDisabled(false).setButtonText('Rebuild');
          this.display();
        }),
      );

    const skipped = this.plugin.service.getStatus().skipped;
    if (skipped > 0) {
      containerEl.createDiv({
        cls: 'sonar-http-status is-error',
        text: `${skipped} file${skipped === 1 ? '' : 's'} skipped (failed to index/extract). Rebuild to retry.`,
      });
    }
  }
}
