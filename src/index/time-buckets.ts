export interface TimeGroup<T> {
  label: string;
  items: T[];
}

/** Start-of-day (local) for a timestamp. */
function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY = 86_400_000;

/**
 * Group items into recency buckets (Today / Yesterday / Past week / Past 30
 * days / Older) using local calendar days, preserving input order within each
 * bucket. Powers the empty-query "browse recent notes" view. Empty buckets are
 * omitted.
 */
export function groupByRecency<T>(
  items: T[],
  mtimeOf: (item: T) => number,
  now: number,
): Array<TimeGroup<T>> {
  const todayStart = dayStart(now);
  const yesterdayStart = todayStart - DAY;
  const weekStart = todayStart - 7 * DAY;
  const monthStart = todayStart - 30 * DAY;

  const buckets: Array<{ label: string; items: T[] }> = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Past week', items: [] },
    { label: 'Past 30 days', items: [] },
    { label: 'Older', items: [] },
  ];

  for (const item of items) {
    const t = mtimeOf(item);
    if (t >= todayStart) buckets[0]!.items.push(item);
    else if (t >= yesterdayStart) buckets[1]!.items.push(item);
    else if (t >= weekStart) buckets[2]!.items.push(item);
    else if (t >= monthStart) buckets[3]!.items.push(item);
    else buckets[4]!.items.push(item);
  }

  return buckets.filter((b) => b.items.length > 0);
}
