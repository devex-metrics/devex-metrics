/**
 * Distribution helpers shared by the report, the history rollups and the
 * dashboard payload.
 *
 * Delivery metrics are heavily right-skewed — one pull request left open over
 * a holiday moves a mean and tells you nothing — so everything here is
 * order-statistic based.
 */

/** Median of `values`. Returns 0 for an empty input. */
export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

/**
 * The `p`-th percentile of `values` using linear interpolation between the
 * two closest ranks (the same definition as NumPy's default and R's type 7).
 * Returns 0 for an empty input. `p` is clamped to [0, 100].
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const clamped = Math.min(100, Math.max(0, p));
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (clamped / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/** The three order statistics reported for every duration metric. */
export interface Quantiles {
  p50: number;
  p75: number;
  p90: number;
  /** Number of observations behind the quantiles. */
  n: number;
}

/** Compute p50/p75/p90 and the sample size in one pass over the input. */
export function quantiles(values: readonly number[]): Quantiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    n: sorted.length,
  };
}

/** Round to `digits` decimal places. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
