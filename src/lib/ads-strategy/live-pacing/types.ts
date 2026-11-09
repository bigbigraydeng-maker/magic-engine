export type LiveMetricSource = 'meta_campaign_insights';

export type ForecastStatus = 'ok' | 'no_history' | 'too_early' | 'missing_samples';

export interface LivePacingScope {
  clientId: string;
  adAccountId: string;
}

export interface LivePacingMeta {
  metricSource: LiveMetricSource;
  accountDay: string;
  timezone: string;
  currency: string;
  sampledAt: string;
  reportLagMinutes: number;
  historyDays: number;
  partial: boolean;
  stale: boolean;
}

export interface HistoricalDayCurve {
  accountDay: string;
  /** Cumulative spend at whole hours 0..24 (index 24 = day total). Length 25. */
  cumulativeSpendByHour: readonly number[];
  daySpendTotal: number;
}

export interface TodayCumulativeSample {
  accountDay: string;
  localMinute: number;
  cumulativeSpend: number;
  cumulativeResults: number | null;
  cumulativeLinkClicks: number | null;
  cumulativeImpressions: number | null;
}

export interface CloseOfDayForecastOk {
  status: 'ok';
  point: number;
  low: number;
  high: number;
  medianShare: number;
  historyDaysUsed: number;
  disclaimer: string;
}

export interface CloseOfDayForecastBlocked {
  status: Exclude<ForecastStatus, 'ok'>;
  point: null;
  low: null;
  high: null;
  medianShare: number | null;
  historyDaysUsed: number;
  reason: string;
}

export type CloseOfDayForecast = CloseOfDayForecastOk | CloseOfDayForecastBlocked;

export interface EfficiencyRates {
  ctrPercent: number | null;
  cpc: number | null;
  cpm: number | null;
}

export interface SegmentWindowDiff {
  fromMinute: number;
  toMinute: number;
  deltaSpend: number | null;
  anomalousNegative: boolean;
  partial: boolean;
}
