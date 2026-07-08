import type { App, TFile } from 'obsidian';
import { subsequenceScore } from '../index/subseq.ts';

export interface FileRecord {
  path: string;
  basename: string;
  ext: string;
  mtime: number;
}

export interface FileHit extends FileRecord {
  score: number;
}

/**
 * Pure ranked search over file records by subsequence match on the basename.
 * Exported separately from the class so ranking is unit-tested headless.
 */
export function searchCatalog(
  records: readonly FileRecord[],
  query: string,
  opts: { limit: number; minScore?: number },
): FileHit[] {
  const minScore = opts.minScore ?? 0;
  const hits: FileHit[] = [];
  for (const r of records) {
    const s = subsequenceScore(query, r.basename);
    if (s === null || s < minScore) continue;
    hits.push({ ...r, score: s });
  }
  hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return hits.slice(0, opts.limit);
}

/**
 * Lightweight index of EVERY file in the vault (all extensions), maintained
 * incrementally. Powers the universal file finder. Not serialized — rebuilt
 * from `vault.getFiles()` at boot in a few ms.
 */
export class FileCatalog {
  private records = new Map<string, FileRecord>();

  constructor(private readonly app: App) {}

  private toRecord(file: TFile): FileRecord {
    return {
      path: file.path,
      basename: file.basename,
      ext: file.extension.toLowerCase(),
      mtime: file.stat.mtime,
    };
  }

  build(): void {
    this.records.clear();
    for (const file of this.app.vault.getFiles()) {
      this.records.set(file.path, this.toRecord(file));
    }
  }

  add(file: TFile): void {
    this.records.set(file.path, this.toRecord(file));
  }

  remove(path: string): void {
    this.records.delete(path);
  }

  rename(oldPath: string, file: TFile): void {
    this.records.delete(oldPath);
    this.records.set(file.path, this.toRecord(file));
  }

  search(query: string, limit: number): FileHit[] {
    // minScore keeps 1–2 char queries from flooding results with weak matches.
    return searchCatalog([...this.records.values()], query, { limit, minScore: 2 });
  }
}
