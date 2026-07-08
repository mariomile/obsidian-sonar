export type BodyFuzzy = 'off' | 'on-sparse' | 'always';

export interface SonarSettings {
  /** Expose the Omnisearch-compatible HTTP search API (desktop only). */
  httpEnabled: boolean;
  httpPort: number;
  /** Index text extracted from PDFs via the Text Extractor plugin. */
  indexPdf: boolean;
  /** Index OCR text extracted from images via the Text Extractor plugin. */
  indexImages: boolean;
  /** Index text content of HTML files natively (no plugin). */
  indexHtml: boolean;
  /** Skip attachments larger than this many megabytes. */
  maxAttachmentMB: number;
  /** Number of results shown in the modal. */
  maxResults: number;
  /** Show per-result score badges and query timing (for tuning ranking). */
  showScoreDebug: boolean;
  /** When body Levenshtein fuzzy fires. */
  bodyFuzzy: BodyFuzzy;
}

export const DEFAULT_SETTINGS: SonarSettings = {
  httpEnabled: false,
  httpPort: 51361,
  indexPdf: true,
  indexImages: false,
  indexHtml: true,
  maxAttachmentMB: 20,
  maxResults: 20,
  showScoreDebug: false,
  bodyFuzzy: 'on-sparse',
};

/** Coerce loaded data into valid settings, filling defaults for missing keys. */
export function parseSettings(data: unknown): SonarSettings {
  const d = (data ?? {}) as Partial<SonarSettings>;
  const port = Number(d.httpPort);
  const maxResults = Number(d.maxResults);
  const maxAttachmentMB = Number(d.maxAttachmentMB);
  return {
    httpEnabled: Boolean(d.httpEnabled),
    httpPort: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_SETTINGS.httpPort,
    indexPdf: d.indexPdf ?? DEFAULT_SETTINGS.indexPdf,
    indexImages: d.indexImages ?? DEFAULT_SETTINGS.indexImages,
    indexHtml: Boolean(d.indexHtml ?? DEFAULT_SETTINGS.indexHtml),
    maxAttachmentMB:
      Number.isFinite(maxAttachmentMB) && maxAttachmentMB > 0
        ? maxAttachmentMB
        : DEFAULT_SETTINGS.maxAttachmentMB,
    maxResults:
      Number.isInteger(maxResults) && maxResults > 0 && maxResults <= 50
        ? maxResults
        : DEFAULT_SETTINGS.maxResults,
    showScoreDebug: Boolean(d.showScoreDebug),
    bodyFuzzy:
      d.bodyFuzzy === 'off' || d.bodyFuzzy === 'always'
        ? d.bodyFuzzy
        : DEFAULT_SETTINGS.bodyFuzzy,
  };
}
