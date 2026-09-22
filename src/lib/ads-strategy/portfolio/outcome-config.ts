/**
 * 客户结果阶梯配置 · 读写（ads IMPACT 阶段 1，设计 §3.2 / §7 L4）。
 *
 * 存在既有 `ad_strategy_configs` 的新列里（migration 20260914000002）。
 * 读失败 / 列还没建 / 没有这一行 → 返回空配置并标来源：诊断据此判 not_comparable，**不猜、不回落行业默认**。
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  DEFAULT_MIN_PRIMARY_PER_UNIT,
  emptyOutcomeConfig,
  isOutcomeStep,
  type OutcomeConfig,
} from './outcome-ladder'

export type OutcomeConfigSource = 'row' | 'no_row' | 'read_error'

export interface LoadedOutcomeConfig {
  config: OutcomeConfig
  source: OutcomeConfigSource
  error?: string
}

const COLUMNS = 'leading_result, primary_result, target_cost_per_primary, min_primary_per_unit'

/** 从一行库数据解析；非法值按未配置处理（不信任库里被手改过的脏值）。 */
export function parseOutcomeConfigRow(row: Record<string, unknown>): OutcomeConfig {
  const target = row.target_cost_per_primary === null || row.target_cost_per_primary === undefined
    ? null
    : Number(row.target_cost_per_primary)
  const min = Number(row.min_primary_per_unit)
  return {
    leading: isOutcomeStep(row.leading_result) ? row.leading_result : null,
    primary: isOutcomeStep(row.primary_result) ? row.primary_result : null,
    targetCostPerPrimary: target !== null && Number.isFinite(target) && target > 0 ? target : null,
    minPrimaryPerUnit: Number.isInteger(min) && min >= 1 ? min : DEFAULT_MIN_PRIMARY_PER_UNIT,
  }
}

export async function loadOutcomeConfig(clientId: string): Promise<LoadedOutcomeConfig> {
  try {
    const { data, error } = await supabaseAdmin
      .from('ad_strategy_configs')
      .select(COLUMNS)
      .eq('client_id', clientId)
      .maybeSingle()
    if (error) return { config: emptyOutcomeConfig(), source: 'read_error', error: error.message }
    if (!data) return { config: emptyOutcomeConfig(), source: 'no_row' }
    return { config: parseOutcomeConfigRow(data as Record<string, unknown>), source: 'row' }
  } catch (err) {
    return { config: emptyOutcomeConfig(), source: 'read_error', error: err instanceof Error ? err.message : String(err) }
  }
}
