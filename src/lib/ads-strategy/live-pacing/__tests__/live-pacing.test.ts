import { describe, expect, it } from 'vitest';
import {
  cumulativeAtMinute,
  effectiveMinute,
  efficiencyFromTotals,
  forecastSpendClose,
  hourlyIncrementsToCumulative,
  median,
  quantile,
  quantileSorted,
  segmentSpendDiff,
  assertSameClient,
} from '../index';
import {
  SYNTHETIC_ACCOUNT,
  SYNTHETIC_CLIENT,
  expectedShareFlatAt,
  sparseHistory2,
  syntheticHistory14,
  todayAtMinute,
} from './fixtures';

describe('live-pacing stats', () => {
  it('median and quantile use (n-1)*q interpolation', () => {
    const values = [0, 10, 20, 30];
    expect(median(values)).toBe(15);
    expect(quantile(values, 0.25)).toBe(7.5);
    expect(quantileSorted([5], 0.75)).toBe(5);
  });

  it('quantile interpolation on even count', () => {
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
  });
});

describe('live-pacing cumulative', () => {
  it('interpolates between hourly knots', () => {
    const knots = hourlyIncrementsToCumulative(Array.from({ length: 24 }, () => 4));
    expect(cumulativeAtMinute(knots, 90)).toBeCloseTo(6, 5);
    expect(cumulativeAtMinute(knots, 24 * 60)).toBe(96);
  });

  it('effective minute respects report lag', () => {
    expect(effectiveMinute(20, 30)).toBe(0);
    expect(effectiveMinute(400, 30)).toBe(370);
  });
});

describe('forecastCloseOfDay', () => {
  it('forecasts spend with sufficient flat history', () => {
    const history = syntheticHistory14();
    const todaySpend = 100;
    const minute = 600;
    const f = forecastSpendClose({ today: todayAtMinute(minute, todaySpend), history });
    expect(f.status).toBe('ok');
    if (f.status !== 'ok') return;
    const share = expectedShareFlatAt(minute);
    expect(f.medianShare).toBeCloseTo(share, 4);
    expect(f.point).toBeCloseTo(todaySpend / share, 3);
    expect(f.low).toBeLessThanOrEqual(f.point);
    expect(f.high).toBeGreaterThanOrEqual(f.point);
  });

  it('no_history when fewer than 3 eligible days', () => {
    const f = forecastSpendClose({
      today: todayAtMinute(600, 50),
      history: sparseHistory2(),
    });
    expect(f.status).toBe('no_history');
  });

  it('too_early when median share below 15%', () => {
    const history = syntheticHistory14();
    const f = forecastSpendClose({
      today: todayAtMinute(60, 5),
      history,
    });
    expect(f.status).toBe('too_early');
  });

  it('missing_samples when today cumulative is zero', () => {
    const f = forecastSpendClose({
      today: todayAtMinute(600, 0),
      history: syntheticHistory14(),
    });
    expect(f.status).toBe('missing_samples');
  });

  it('zero denominator paths return blocked, not NaN', () => {
    const f = forecastSpendClose({
      today: todayAtMinute(600, -1),
      history: syntheticHistory14(),
    });
    expect(f.status).toBe('missing_samples');
    expect(f.point).toBeNull();
  });
});

describe('segment windows', () => {
  it('flags negative diffs without zeroing', () => {
    const samples = [
      { localMinute: 0, cumulativeSpend: 10 },
      { localMinute: 30, cumulativeSpend: 8 },
    ];
    const seg = segmentSpendDiff(samples, 0, 30);
    expect(seg.deltaSpend).toBe(-2);
    expect(seg.anomalousNegative).toBe(true);
  });

  it('partial when boundary sample missing', () => {
    const seg = segmentSpendDiff([{ localMinute: 10, cumulativeSpend: 5 }], 0, 30);
    expect(seg.partial).toBe(true);
    expect(seg.deltaSpend).toBeNull();
  });
});

describe('efficiency', () => {
  it('returns null when denominators non-positive', () => {
    expect(efficiencyFromTotals(10, 0, 5).ctrPercent).toBeNull();
    expect(efficiencyFromTotals(10, 100, 0).cpc).toBeNull();
    expect(efficiencyFromTotals(null, 100, 5).cpm).toBeNull();
  });

  it('computes CTR/CPC/CPM when inputs valid', () => {
    const e = efficiencyFromTotals(50, 1000, 25);
    expect(e.ctrPercent).toBe(2.5);
    expect(e.cpc).toBe(2);
    expect(e.cpm).toBe(50);
  });
});

describe('cross-client refusal', () => {
  it('rejects mismatched client ids', () => {
    const r = assertSameClient({ clientId: SYNTHETIC_CLIENT, adAccountId: SYNTHETIC_ACCOUNT }, 'other-client');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('cross_client');
  });

  it('accepts same client', () => {
    expect(assertSameClient({ clientId: SYNTHETIC_CLIENT, adAccountId: SYNTHETIC_ACCOUNT }, SYNTHETIC_CLIENT).ok).toBe(
      true,
    );
  });
});

describe('day rollover edge', () => {
  it('cumulative at end of account day equals day total', () => {
    const history = syntheticHistory14()[0]!;
    expect(cumulativeAtMinute(history.cumulativeSpendByHour, 23 * 60 + 59)).toBeLessThanOrEqual(history.daySpendTotal);
    expect(cumulativeAtMinute(history.cumulativeSpendByHour, 24 * 60)).toBe(history.daySpendTotal);
  });
});
