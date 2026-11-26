/**
 * In-memory daily trend Check pass (loads from cron later; PR-2 = rules + receipt only).
 */

import { DEFAULT_TREND_CHECK_RULES, rulesFromLeadsConfig, type TrendCheckRules } from './config'
import { judgeDailyTrendForEntity } from './rules'
import type { TrendCheckRunInput, TrendCheckRunReceipt, TrendCheckRunResult, TrendFinding } from './types'

export interface TrendCheckJudgeOptions {
  readonly rules?: TrendCheckRules
  readonly leads_config?: unknown
}

export function resolveTrendCheckRules(opts: TrendCheckJudgeOptions = {}): TrendCheckRules {
  if (opts.rules) return opts.rules
  if (opts.leads_config !== undefined) return rulesFromLeadsConfig(opts.leads_config)
  return DEFAULT_TREND_CHECK_RULES
}

export function runDailyTrendCheck(
  input: TrendCheckRunInput,
  opts: TrendCheckJudgeOptions = {},
): TrendCheckRunResult {
  const rules = resolveTrendCheckRules(opts)
  const findings: TrendFinding[] = []
  let evaluated = 0
  for (const entity of input.entities) {
    evaluated += 1
    findings.push(
      ...judgeDailyTrendForEntity(entity, input.evaluation_date, input.target_cost_per_primary, rules),
    )
  }
  return {
    client_slug: input.client_slug,
    evaluation_date: input.evaluation_date,
    findings,
    entity_count: input.entities.length,
    rules_evaluated: evaluated,
  }
}

export function buildTrendCheckRunReceipt(result: TrendCheckRunResult): TrendCheckRunReceipt {
  return {
    kind: 'ads_daily_trend_check',
    client_slug: result.client_slug,
    evaluation_date: result.evaluation_date,
    findings_count: result.findings.length,
    diagnosis_codes: [...new Set(result.findings.map((f) => f.diagnosis_code))],
    rule_ids: [...new Set(result.findings.flatMap((f) => f.evidence.rule_ids))],
  }
}
