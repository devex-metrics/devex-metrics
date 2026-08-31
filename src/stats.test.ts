import { describe, it, expect } from "vitest";
import {
  median,
  percentile,
  quantiles,
  round,
  gini,
  shareAtLeast,
} from "./stats.js";

describe("median", () => {
  it("returns 0 for an empty input", () => {
    expect(median([])).toBe(0);
  });

  it("returns the middle value for an odd-length input", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for an even-length input", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("does not mutate the input", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("percentile", () => {
  it("returns 0 for an empty input", () => {
    expect(percentile([], 90)).toBe(0);
  });

  it("returns the only value for a single-element input", () => {
    expect(percentile([7], 90)).toBe(7);
  });

  it("returns the extremes at p0 and p100", () => {
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
  });

  it("interpolates between ranks", () => {
    // rank = 0.75 * 3 = 2.25 → between 3 and 4
    expect(percentile([1, 2, 3, 4], 75)).toBeCloseTo(3.25, 10);
  });

  it("clamps out-of-range percentiles", () => {
    expect(percentile([1, 2, 3], -10)).toBe(1);
    expect(percentile([1, 2, 3], 150)).toBe(3);
  });

  it("agrees with median at p50", () => {
    const values = [5, 1, 9, 3, 7];
    expect(percentile(values, 50)).toBe(median(values));
  });
});

describe("quantiles", () => {
  it("reports p50, p75, p90 and the sample size", () => {
    const q = quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(q.n).toBe(10);
    expect(q.p50).toBeCloseTo(5.5, 10);
    expect(q.p75).toBeCloseTo(7.75, 10);
    expect(q.p90).toBeCloseTo(9.1, 10);
  });

  it("returns zeroes and n=0 for an empty input", () => {
    expect(quantiles([])).toEqual({ p50: 0, p75: 0, p90: 0, n: 0 });
  });

  it("is not thrown off by an extreme outlier the way a mean would be", () => {
    const q = quantiles([1, 1, 1, 1, 1000]);
    expect(q.p50).toBe(1);
  });
});

describe("round", () => {
  it("rounds to two decimals by default", () => {
    expect(round(1.23456)).toBe(1.23);
  });

  it("honours an explicit digit count", () => {
    expect(round(1.23456, 3)).toBe(1.235);
    expect(round(1.6, 0)).toBe(2);
  });
});

describe("gini", () => {
  it("is 0 for an empty input", () => {
    expect(gini([])).toBe(0);
  });

  it("is 0 for a single value — one reviewer cannot be unequal", () => {
    expect(gini([7])).toBe(0);
  });

  it("is 0 for a perfectly even distribution", () => {
    expect(gini([5, 5, 5, 5])).toBeCloseTo(0, 10);
  });

  it("is 0 when every value is zero", () => {
    expect(gini([0, 0, 0])).toBe(0);
  });

  it("approaches (n-1)/n when one value takes everything", () => {
    // Four reviewers, one does all the work: the maximum for n=4 is 0.75.
    expect(gini([0, 0, 0, 100])).toBeCloseTo(0.75, 10);
  });

  it("rises as the distribution becomes more lopsided", () => {
    const even = gini([10, 10, 10, 10]);
    const skewed = gini([1, 2, 7, 30]);
    const extreme = gini([1, 1, 1, 97]);
    expect(even).toBeLessThan(skewed);
    expect(skewed).toBeLessThan(extreme);
  });

  it("matches the textbook value for a known distribution", () => {
    // [1,2,3,4] → 2*(1*1+2*2+3*3+4*4)/(4*10) - 5/4 = 1.5 - 1.25 = 0.25
    expect(gini([1, 2, 3, 4])).toBeCloseTo(0.25, 10);
  });

  it("ignores order", () => {
    expect(gini([4, 1, 3, 2])).toBeCloseTo(gini([1, 2, 3, 4]), 10);
  });

  it("drops negative and non-finite values rather than producing nonsense", () => {
    expect(gini([1, 2, 3, 4, -5])).toBeCloseTo(gini([1, 2, 3, 4]), 10);
    expect(gini([1, 2, 3, 4, Number.NaN])).toBeCloseTo(gini([1, 2, 3, 4]), 10);
  });

  it("does not mutate the input", () => {
    const input = [3, 1, 2];
    gini(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("shareAtLeast", () => {
  it("returns 0 rather than NaN for an empty input", () => {
    expect(shareAtLeast([], 400)).toBe(0);
  });

  it("counts values at the threshold as over it", () => {
    expect(shareAtLeast([400], 400)).toBe(100);
  });

  it("reports the percentage over the threshold", () => {
    expect(shareAtLeast([10, 100, 500, 900], 400)).toBe(50);
  });

  it("is 0 when nothing reaches the threshold", () => {
    expect(shareAtLeast([1, 2, 3], 400)).toBe(0);
  });
});
