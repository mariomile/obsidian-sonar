/**
 * Reciprocal Rank Fusion: combine several ranked lists into one, scoring each
 * item by Σ 1/(k + rank) across the lists it appears in. Rank-based (not
 * score-based) fusion means lists with incomparable score scales — e.g. BM25
 * keyword scores and semantic cosine similarities in Wave 2 — merge sensibly
 * without normalization. Items are keyed by `path`.
 */
export function reciprocalRankFusion<T extends { path: string }>(
  lists: T[][],
  k = 60,
): Array<{ item: T; score: number }> {
  const scores = new Map<string, number>();
  const items = new Map<string, T>();
  const order: string[] = [];

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]!;
      const contribution = 1 / (k + rank);
      if (!items.has(item.path)) {
        items.set(item.path, item);
        order.push(item.path);
      }
      scores.set(item.path, (scores.get(item.path) ?? 0) + contribution);
    }
  }

  // Sort by fused score desc; ties keep first-encounter order (stable via index).
  const indexOf = new Map(order.map((p, i) => [p, i]));
  return order
    .map((path) => ({ item: items.get(path)!, score: scores.get(path)! }))
    .sort((a, b) => b.score - a.score || indexOf.get(a.item.path)! - indexOf.get(b.item.path)!);
}
