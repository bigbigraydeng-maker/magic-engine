/**
 * Read-only defaults for ads execution prescription experience readback (phase 3).
 * Client overrides live under leads_config.ads_execution_review (same block as review windows).
 */

import { ADS_EXECUTION_REVIEW_CONFIG_KEY } from '@/lib/flywheel/attribution/review-verdict-rules'

export interface AdsExecutionPrescriptionReadbackRules {
  readonly lookbackDays: number
  readonly notUsefulDownrankPenalty: number
  readonly minNotUsefulToDownrank: number
}

export const DEFAULT_ADS_EXECUTION_PRESCRIPTION_READBACK_RULES: AdsExecutionPrescriptionReadbackRules = {
  lookbackDays: 90,
  notUsefulDownrankPenalty: 100,
  minNotUsefulToDownrank: 1,
}

function whole(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null
  return value
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function readbackRulesFromLeadsConfig(leadsConfig: unknown): AdsExecutionPrescriptionReadbackRules {
  const base = DEFAULT_ADS_EXECUTION_PRESCRIPTION_READBACK_RULES
  const root = objectOf(leadsConfig)
  const block = objectOf(root?.[ADS_EXECUTION_REVIEW_CONFIG_KEY])
  if (!block) return base
  return {
    lookbackDays: whole(block.experience_lookback_days, 7, 365) ?? base.lookbackDays,
    notUsefulDownrankPenalty: whole(block.not_useful_downrank_penalty, 1, 10_000) ?? base.notUsefulDownrankPenalty,
    minNotUsefulToDownrank: whole(block.min_not_useful_to_downrank, 1, 100) ?? base.minNotUsefulToDownrank,
  }
}
