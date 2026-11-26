import { CUMULATIVE_HOUR_KNOTS } from './constants';

/** Build 25 cumulative knots: index h = cumulative at start of hour h (index 24 = day total). */
export function hourlyIncrementsToCumulative(hourly: readonly number[]): number[] {
  const knots = new Array<number>(CUMULATIVE_HOUR_KNOTS).fill(0);
  let running = 0;
  knots[0] = 0;
  for (let h = 0; h < 24; h++) {
    running += hourly[h] ?? 0;
    knots[h + 1] = running;
  }
  return knots;
}

/** Linear interpolate cumulative spend at account-local minute [0, 1440). */
export function cumulativeAtMinute(knots: readonly number[], localMinute: number): number | null {
  if (knots.length !== CUMULATIVE_HOUR_KNOTS) return null;
  if (!Number.isFinite(localMinute) || localMinute < 0) return null;
  if (localMinute >= 24 * 60) return knots[24] ?? null;
  const hour = Math.floor(localMinute / 60);
  const frac = (localMinute % 60) / 60;
  const a = knots[hour] ?? 0;
  const b = knots[Math.min(hour + 1, 24)] ?? a;
  return a + (b - a) * frac;
}

export function effectiveMinute(localMinute: number, reportLagMinutes: number): number {
  if (!Number.isFinite(localMinute) || localMinute < 0) return 0;
  const lag = Number.isFinite(reportLagMinutes) && reportLagMinutes > 0 ? reportLagMinutes : 0;
  return Math.max(localMinute - lag, 0);
}
