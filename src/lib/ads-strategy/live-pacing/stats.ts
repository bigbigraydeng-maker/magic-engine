/** Sorted-array linear-interpolation quantile (position (n−1)·q), matching new ME Python. */
export function quantileSorted(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0 || !Number.isFinite(q) || q < 0 || q > 1) return null;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower]!;
  const frac = pos - lower;
  return sorted[lower]! * (1 - frac) + sorted[upper]! * frac;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return quantileSorted(sorted, 0.5);
}

export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return quantileSorted(sorted, q);
}
