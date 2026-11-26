import {
  FORECAST_MIN_ELIGIBLE_DAYS,
  FORECAST_MIN_SHARE,
  FORECAST_SHARE_DIV_FLOOR,
  REPORT_LAG_MINUTES,
} from './constants';
import { cumulativeAtMinute, effectiveMinute } from './cumulative';
import { median, quantile } from './stats';
import type {
  CloseOfDayForecast,
  CloseOfDayForecastBlocked,
  CloseOfDayForecastOk,
  HistoricalDayCurve,
  TodayCumulativeSample,
} from './types';

const DISCLAIMER =
  '区间来自历史日内节奏离散范围，不是统计置信区间；素材、预算或状态变化会使外推失准。';

function blocked(
  status: CloseOfDayForecastBlocked['status'],
  reason: string,
  historyDaysUsed: number,
  medianShare: number | null = null,
): CloseOfDayForecastBlocked {
  return {
    status,
    point: null,
    low: null,
    high: null,
    medianShare,
    historyDaysUsed,
    reason,
  };
}

export interface CloseOfDayInput {
  today: TodayCumulativeSample;
  history: readonly HistoricalDayCurve[];
  reportLagMinutes?: number;
}

/** Port of new ME spend/results/clicks close-of-day forecast (same share for all metrics). */
export function forecastCloseOfDay(
  input: CloseOfDayInput,
  cumulativeToday: number,
): CloseOfDayForecast {
  if (!Number.isFinite(cumulativeToday) || cumulativeToday <= 0) {
    return blocked('missing_samples', '今天还没有可用的累计样本。', 0);
  }

  const lag = input.reportLagMinutes ?? REPORT_LAG_MINUTES;
  const e = effectiveMinute(input.today.localMinute, lag);

  const shares: number[] = [];
  for (const day of input.history) {
    if (day.daySpendTotal <= 0) continue;
    const cum = cumulativeAtMinute(day.cumulativeSpendByHour, e);
    if (cum === null || cum <= 0) continue;
    shares.push(cum / day.daySpendTotal);
  }

  const historyDaysUsed = shares.length;
  if (historyDaysUsed < FORECAST_MIN_ELIGIBLE_DAYS) {
    return blocked('no_history', `历史有效天数不足（需要至少 ${FORECAST_MIN_ELIGIBLE_DAYS} 天）。`, historyDaysUsed);
  }

  const shareMed = median(shares);
  if (shareMed === null || shareMed < FORECAST_MIN_SHARE) {
    return blocked('too_early', '日内节奏占比过低，尚不适合预测今日收盘。', historyDaysUsed, shareMed);
  }

  const q75 = quantile(shares, 0.75) ?? shareMed;
  const q25 = quantile(shares, 0.25) ?? shareMed;

  const point = cumulativeToday / shareMed;
  const lowDiv = Math.max(q75, shareMed);
  const highDiv = Math.max(Math.min(q25, shareMed), FORECAST_SHARE_DIV_FLOOR);
  const low = cumulativeToday / lowDiv;
  const high = cumulativeToday / highDiv;

  const ok: CloseOfDayForecastOk = {
    status: 'ok',
    point,
    low: Math.min(low, high),
    high: Math.max(low, high),
    medianShare: shareMed,
    historyDaysUsed,
    disclaimer: DISCLAIMER,
  };
  return ok;
}

export function forecastSpendClose(input: CloseOfDayInput): CloseOfDayForecast {
  return forecastCloseOfDay(input, input.today.cumulativeSpend);
}

export function forecastResultsClose(input: CloseOfDayInput): CloseOfDayForecast {
  const v = input.today.cumulativeResults;
  if (v === null || !Number.isFinite(v)) {
    return blocked('missing_samples', '今天没有可用的结果累计样本。', 0);
  }
  return forecastCloseOfDay(input, v);
}

export function forecastLinkClicksClose(input: CloseOfDayInput): CloseOfDayForecast {
  const v = input.today.cumulativeLinkClicks;
  if (v === null || !Number.isFinite(v)) {
    return blocked('missing_samples', '今天没有可用的链接点击累计样本。', 0);
  }
  return forecastCloseOfDay(input, v);
}
