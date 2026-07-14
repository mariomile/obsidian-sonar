/** Which timestamp a sort key resolves to. Default 'modified' → mtime. This is
 *  the single definition of the non-relevance sort vocabulary, shared by
 *  SearchService, FileCatalog, and the modal's typed-search re-sort. */
export type RecentSortBy = 'created' | 'modified' | 'viewed';

/** Single source of truth for what each sort key *means*. Callers gather the
 *  raw timestamps (`ctime` defaulting to `mtime` when the file is gone,
 *  `lastOpened` from frecency); this picks the one the sort key selects. */
export function resolveSortTime(
  sortBy: RecentSortBy,
  times: { mtime: number; ctime: number; lastOpened: number | undefined },
): number {
  switch (sortBy) {
    case 'created':
      return times.ctime;
    case 'viewed':
      return times.lastOpened ?? times.mtime;
    default:
      return times.mtime;
  }
}
