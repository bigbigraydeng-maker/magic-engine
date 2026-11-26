import { cumulativeAtMinute } from './cumulative';
import type { SegmentWindowDiff } from './types';

export interface CumulativeSamplePoint {
  localMinute: number;
  cumulativeSpend: number;
}

/**
 * Segment spend = difference of cumulative samples; unknown when a boundary has no sample.
 * Negative diffs are kept and flagged (report backfill artefact).
 */
export function segmentSpendDiff(
  samples: readonly CumulativeSamplePoint[],
  fromMinute: number,
  toMinute: number,
): SegmentWindowDiff {
  const findAtOrBefore = (minute: number): number | null => {
    let best: CumulativeSamplePoint | null = null;
    for (const s of samples) {
      if (s.localMinute <= minute && (best === null || s.localMinute > best.localMinute)) {
        best = s;
      }
    }
    return best?.cumulativeSpend ?? null;
  };

  const start = findAtOrBefore(fromMinute);
  const end = findAtOrBefore(toMinute);
  if (start === null || end === null) {
    return {
      fromMinute,
      toMinute,
      deltaSpend: null,
      anomalousNegative: false,
      partial: true,
    };
  }
  const delta = end - start;
  return {
    fromMinute,
    toMinute,
    deltaSpend: delta,
    anomalousNegative: delta < 0,
    partial: false,
  };
}

/** Cumulative at minute from hourly knots when only historical curves exist. */
export function historicalCumulativeAt(
  knots: readonly number[],
  localMinute: number,
): number | null {
  return cumulativeAtMinute(knots, localMinute);
}
