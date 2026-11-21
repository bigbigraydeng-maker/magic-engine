export {
  ADS_TREND_CHECK_CONFIG_KEY,
  DEFAULT_TREND_CHECK_RULES,
  rulesFromLeadsConfig,
  trendCheckPatrolEnabled,
  type TrendCheckRules,
} from './config'
export { judgeDailyTrendForEntity } from './rules'
export { judgeTrendCheckPatrol, toTuneReady, type TrendCheckPatrolSurface, type TuneReadyTrendFinding } from './patrol-surface'
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
