/**
 * P21.1 — 模型分层路由
 *
 * strategy（战略层）→ Sonnet 4.6：张骞/华佗等复杂分析、规划场景
 * production（生产层）→ Haiku 4.5：AI Factory 批量内容生成，降本
 */

import { MODEL_SONNET, MODEL_HAIKU } from '../anthropic/client'

export type ModelTier = 'strategy' | 'production'

export interface ModelConfig {
  model: string
  priceInputPerM: number
  priceOutputPerM: number
}

const TIER_CONFIGS: Record<ModelTier, ModelConfig> = {
  strategy: {
    model: MODEL_SONNET,
    priceInputPerM: 3.0,
    priceOutputPerM: 15.0,
  },
  production: {
    // Haiku 4.5: $0.80/MTok in, $4/MTok out — 约 3.75x 于 Sonnet 便宜
    model: MODEL_HAIKU,
    priceInputPerM: 0.80,
    priceOutputPerM: 4.0,
  },
}

export function routeModel(tier: ModelTier): ModelConfig {
  const cfg = TIER_CONFIGS[tier]
  if (!cfg) throw new Error(`Invalid model tier: "${tier}"`)
  return cfg
}

export function calcCost(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const { priceInputPerM, priceOutputPerM } = routeModel(tier)
  return (inputTokens / 1_000_000) * priceInputPerM
    + (outputTokens / 1_000_000) * priceOutputPerM
}
