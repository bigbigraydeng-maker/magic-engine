/** Close-of-day pacing forecast (ported from new ME intraday v0.1; not CRM hourly-leads). */
export const LIVE_PACING_ALGO_VERSION = 'live-pacing/1.0.0';

/** Meta report delay assumed before intraday samples are comparable. */
export const REPORT_LAG_MINUTES = 30;

/** Historical window for close-of-day share median / quantiles. */
export const FORECAST_HISTORY_DAYS = 14;

export const FORECAST_MIN_ELIGIBLE_DAYS = 3;

/** Below this median intraday share, forecast is withheld (too early in the day). */
export const FORECAST_MIN_SHARE = 0.15;

/** Floor for quantile divisor in spend high bound. */
export const FORECAST_SHARE_DIV_FLOOR = 1e-6;

/** Whole-hour knots 0..24 inclusive (25 points) for cumulative intraday curves. */
export const CUMULATIVE_HOUR_KNOTS = 25;
