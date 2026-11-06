/**
 * Side-by-side layout for overlapping timed items within one day column.
 * Items are positioned in columns; each item expands to the right over
 * columns that are free for its whole duration.
 */
export interface Positioned {
  col: number;
  cols: number;
  span: number;
}

export function layoutDay<T extends { startMin: number; endMin: number }>(
  items: T[],
  minVisualMin = 22,
): (T & Positioned)[] {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin,
  );
  const visEnd = (it: T) => Math.max(it.endMin, it.startMin + minVisualMin);
  const result: (T & Positioned)[] = [];

  let cluster: { item: T; col: number }[] = [];
  let columnsEnd: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const cols = columnsEnd.length;
    for (const { item, col } of cluster) {
      let span = 1;
      for (let c = col + 1; c < cols; c++) {
        const blocked = cluster.some(
          (o) => o.col === c && o.item.startMin < visEnd(item) && visEnd(o.item) > item.startMin,
        );
        if (blocked) break;
        span++;
      }
      result.push({ ...item, col, cols, span });
    }
    cluster = [];
    columnsEnd = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (item.startMin >= clusterEnd && cluster.length) flush();
    let col = columnsEnd.findIndex((end) => end <= item.startMin);
    if (col === -1) {
      col = columnsEnd.length;
      columnsEnd.push(visEnd(item));
    } else {
      columnsEnd[col] = visEnd(item);
    }
    cluster.push({ item, col });
    clusterEnd = Math.max(clusterEnd, visEnd(item));
  }
  if (cluster.length) flush();
  return result;
}
