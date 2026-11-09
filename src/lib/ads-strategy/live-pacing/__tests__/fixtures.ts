import { hourlyIncrementsToCumulative } from '../cumulative';
import type { HistoricalDayCurve, TodayCumulativeSample } from '../types';

const SYNTHETIC_CLIENT = 'client-synth-0001';
const SYNTHETIC_ACCOUNT = 'act_synth_0001';

export { SYNTHETIC_CLIENT, SYNTHETIC_ACCOUNT };

/** Flat hourly spend: 10 units per hour → linear cumulative through the day. */
function flatDay(day: string, hourlyUnit = 10): HistoricalDayCurve {
  const hourly = Array.from({ length: 24 }, () => hourlyUnit);
  const cumulativeSpendByHour = hourlyIncrementsToCumulative(hourly);
  return {
    accountDay: day,
    cumulativeSpendByHour,
    daySpendTotal: hourlyUnit * 24,
  };
}

/** 14 eligible history days with identical shape. */
export function syntheticHistory14(): HistoricalDayCurve[] {
  return Array.from({ length: 14 }, (_, i) => flatDay(`2026-11-${String(i + 1).padStart(2, '0')}`));
}

export function sparseHistory2(): HistoricalDayCurve[] {
  return [flatDay('2026-11-01'), flatDay('2026-11-02')];
}

export function todayAtMinute(minute: number, cumulativeSpend: number): TodayCumulativeSample {
  return {
    accountDay: '2026-11-15',
    localMinute: minute,
    cumulativeSpend,
    cumulativeResults: null,
    cumulativeLinkClicks: null,
    cumulativeImpressions: null,
  };
}

/** At minute 600 (10:00), flat history share at lag 30 → cum at 570 min = 9.5h * 10 = 95, total 240 → share 0.3958 */
export function expectedShareFlatAt(minute: number, lag = 30): number {
  const e = Math.max(minute - lag, 0);
  const cum = (e / 60) * 10;
  return cum / 240;
}
