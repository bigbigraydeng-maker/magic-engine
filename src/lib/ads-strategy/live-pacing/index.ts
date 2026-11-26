export {
  LIVE_PACING_ALGO_VERSION,
  REPORT_LAG_MINUTES,
  FORECAST_HISTORY_DAYS,
  FORECAST_MIN_ELIGIBLE_DAYS,
  FORECAST_MIN_SHARE,
  CUMULATIVE_HOUR_KNOTS,
} from './constants';
export type {
  CloseOfDayForecast,
  EfficiencyRates,
  ForecastStatus,
  HistoricalDayCurve,
  LiveMetricSource,
  LivePacingMeta,
  LivePacingScope,
  SegmentWindowDiff,
  TodayCumulativeSample,
} from './types';
export { hourlyIncrementsToCumulative, cumulativeAtMinute, effectiveMinute } from './cumulative';
export { median, quantile, quantileSorted } from './stats';
export {
  forecastCloseOfDay,
  forecastSpendClose,
  forecastResultsClose,
  forecastLinkClicksClose,
  type CloseOfDayInput,
} from './forecast';
export { segmentSpendDiff, historicalCumulativeAt, type CumulativeSamplePoint } from './windows';
export { efficiencyFromTotals } from './efficiency';
export { assertSameClient, type ScopeRefusal, type ScopeOk } from './scope';
