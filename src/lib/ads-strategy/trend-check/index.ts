export { ADS_TREND_CHECK_CONFIG_KEY, DEFAULT_TREND_CHECK_RULES, rulesFromLeadsConfig, type TrendCheckRules } from './config'
export { judgeDailyTrendForEntity } from './rules'
export { buildTrendCheckRunReceipt, resolveTrendCheckRules, runDailyTrendCheck, type TrendCheckJudgeOptions } from './run'
export type {
  TrendCheckRunInput,
  TrendCheckRunReceipt,
  TrendCheckRunResult,
  TrendDailyRow,
  TrendEntitySeries,
  TrendFinding,
  TrendIntradayHook,
  TrendSubject,
} from './types'
