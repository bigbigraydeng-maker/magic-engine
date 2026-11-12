/**
 * Apply auto_extracted execution-review experience when building ads execution prescriptions (read-only).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  appendExperienceHint,
  formatExperienceHint,
  loadExecutionReviewExperience,
  type AdsExecutionItemType,
  type ExecutionExperienceByType,
} from './ads-execution-prescription-experience'
import {
  readbackRulesFromLeadsConfig,
  type AdsExecutionPrescriptionReadbackRules,
} from './ads-execution-prescription-rules'

export interface AdsExecutionPrescriptionItemDraft {
  readonly type: AdsExecutionItemType
  readonly priority: number
  readonly label?: string
}

export interface AdsExecutionPrescriptionItem extends AdsExecutionPrescriptionItemDraft {
  readonly order: number
  readonly adjustedPriority: number
  readonly experienceHint: string | null
}

export interface AdsExecutionPrescription {
  readonly clientId: string
  readonly generatedAt: string
  readonly lookbackDays: number
  readonly experience: ExecutionExperienceByType
  readonly items: readonly AdsExecutionPrescriptionItem[]
}

function adjustedPriority(
  base: number,
  type: AdsExecutionItemType,
  experience: ExecutionExperienceByType,
  rules: AdsExecutionPrescriptionReadbackRules,
): number {
  const notUseful = experience[type].not_useful
  if (notUseful < rules.minNotUsefulToDownrank) return base
  return base + rules.notUsefulDownrankPenalty
}

export function applyExperienceToPrescriptionItems(
  items: readonly AdsExecutionPrescriptionItemDraft[],
  experience: ExecutionExperienceByType,
  rules: AdsExecutionPrescriptionReadbackRules,
): AdsExecutionPrescriptionItem[] {
  const withMeta = items.map((item) => {
    const adj = adjustedPriority(item.priority, item.type, experience, rules)
    const experienceHint = formatExperienceHint(item.type, experience[item.type], rules.lookbackDays)
    return { ...item, adjustedPriority: adj, experienceHint }
  })
  withMeta.sort((a, b) => a.adjustedPriority - b.adjustedPriority || a.priority - b.priority)
  return withMeta.map((item, index) => ({ ...item, order: index }))
}

export async function generateAdsExecutionPrescription(
  sb: SupabaseClient,
  input: {
    clientId: string
    items: readonly AdsExecutionPrescriptionItemDraft[]
    now?: Date
    leadsConfig?: unknown
  },
): Promise<AdsExecutionPrescription> {
  const now = input.now ?? new Date()
  const rules = readbackRulesFromLeadsConfig(input.leadsConfig)
  const experience = await loadExecutionReviewExperience(sb, input.clientId, rules, now)
  const items = applyExperienceToPrescriptionItems(input.items, experience, rules)
  return {
    clientId: input.clientId,
    generatedAt: now.toISOString(),
    lookbackDays: rules.lookbackDays,
    experience,
    items,
  }
}

export async function experienceHintForItemType(
  sb: SupabaseClient,
  clientId: string,
  type: AdsExecutionItemType,
  leadsConfig?: unknown,
  now?: Date,
): Promise<string | null> {
  const rules = readbackRulesFromLeadsConfig(leadsConfig)
  const experience = await loadExecutionReviewExperience(sb, clientId, rules, now)
  return formatExperienceHint(type, experience[type], rules.lookbackDays)
}

export async function scopeWithExecutionExperience(
  sb: SupabaseClient,
  clientId: string,
  type: AdsExecutionItemType,
  baseScope: string,
  leadsConfig?: unknown,
  now?: Date,
): Promise<string> {
  const hint = await experienceHintForItemType(sb, clientId, type, leadsConfig, now)
  return appendExperienceHint(baseScope, hint)
}
