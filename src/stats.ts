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

/**
 * Gini coefficient of `values` — 0 when every value is identical, approaching
 * 1 as a single value takes the whole total.
 *
 * Used for review load: a team where one person reviews everything scores near
 * 1, a team that shares the work evenly scores near 0. Zero entries are kept
 * on purpose — a nominal reviewer who reviews nothing is part of the
 * inequality, not absent from it.
 *
 * Returns 0 for the degenerate cases where inequality is undefined: fewer than
 * two values, or a total of zero. Negative and non-finite values are dropped,
 * since a negative share has no meaning here.
 */
export function gini(values: readonly number[]): number {
  const clean = values.filter((v) => Number.isFinite(v) && v >= 0);
  const n = clean.length;
  if (n < 2) return 0;
  const sorted = [...clean].sort((a, b) => a - b);
  let total = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    total += sorted[i];
    weighted += (i + 1) * sorted[i];
  }
  if (total === 0) return 0;
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/**
 * Share of `values` at or above `threshold`, as a percentage. Returns 0 for an
 * empty input rather than NaN, so a repository with no pull requests renders as
 * a zero instead of a hole.
 */
export function shareAtLeast(values: readonly number[], threshold: number): number {
  if (values.length === 0) return 0;
  const hits = values.filter((v) => v >= threshold).length;
  return (hits / values.length) * 100;
}
