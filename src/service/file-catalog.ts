import { type App, TFile } from 'obsidian';
import { subsequenceScore } from '../index/subseq.ts';
import type { FrecencyTracker } from './frecency.ts';

export interface FileRecord {
  path: string;
  basename: string;
  ext: string;
  mtime: number;
}

/** Which timestamp `recent()` sorts by. Default 'modified' keeps existing
 *  call sites' behavior unchanged. */
export type RecentSortBy = 'created' | 'modified' | 'viewed';

export interface RecentRecord extends FileRecord {
  /** The timestamp actually used for ordering — whichever `sortBy` picked. */
  sortTime: number;
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
 * Minimum subsequence score to accept, scaled by query length. Short queries
 * match almost anything, so they need a higher bar to avoid flooding the fused
 * list with weak name hits; longer queries can relax.
 */
export function minScoreFor(query: string): number {
  const n = query.trim().length;
  if (n <= 1) return 12;
  if (n === 2) return 8;
  if (n === 3) return 5;
  return 4;
}

/**
 * Lightweight index of EVERY file in the vault (all extensions), maintained
 * incrementally. Powers the universal file finder. Not serialized — rebuilt
 * from `vault.getFiles()` at boot in a few ms.
 */
export class FileCatalog {
  private records = new Map<string, FileRecord>();

  /** Wired from main.ts the same way SearchService.frecency is — optional so
   *  the catalog stays constructible/testable without a tracker. */
  frecency: FrecencyTracker | null = null;

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
    // Length-scaled minScore keeps short queries from flooding with weak hits.
    return searchCatalog([...this.records.values()], query, {
      limit,
      minScore: minScoreFor(query),
    });
  }

  /** The timestamp `sortBy` resolves to for a record. 'created' does a live
   *  TFile.stat.ctime lookup; 'viewed' reads frecency's last-opened; both
   *  fall back to mtime when unavailable. */
  private sortTimeFor(rec: FileRecord, sortBy: RecentSortBy): number {
    if (sortBy === 'created') {
      const file = this.app.vault.getAbstractFileByPath(rec.path);
      return file instanceof TFile ? file.stat.ctime : rec.mtime;
    }
    if (sortBy === 'viewed') {
      return this.frecency?.lastOpened(rec.path) ?? rec.mtime;
    }
    return rec.mtime;
  }

  /** Most recently modified (or created/viewed) files (all types), optionally
   *  filtered — powers a catalog-backed empty-query browse for types the
   *  index doesn't hold. Sort key computed for every record before slicing
   *  to `limit`. */
  recent(
    limit: number,
    predicate?: (rec: FileRecord) => boolean,
    sortBy: RecentSortBy = 'modified',
  ): RecentRecord[] {
    const out: RecentRecord[] = [];
    for (const rec of this.records.values()) {
      if (!predicate || predicate(rec)) {
        out.push({ ...rec, sortTime: this.sortTimeFor(rec, sortBy) });
      }
    }
    out.sort((a, b) => b.sortTime - a.sortTime);
    return out.slice(0, limit);
  }
}
