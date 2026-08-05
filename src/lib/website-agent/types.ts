import type { MemoryContext } from '@/lib/memory/types'
import type { StrategyItem } from '@/lib/strategy/types'
import type { PriorityAction, ZhugeFeedbackSummary } from '@/lib/zhuge/types'

export type WebsiteGrowthLane =
  | 'technical_seo'
  | 'content_intent'
  | 'ai_visibility'

export interface WebsitePageSignal {
  id: string
  url: string
  title: string | null
  page_type: string
  topics: string[]
  primary_keyword: string | null
  word_count: number | null
  has_geo_block: boolean
  status_code: number | null
  crawled_at?: string | null
}

export interface WebsiteGrowthAgentInput {
  clientId: string
  domain: string
  pages: WebsitePageSignal[]
  strategyItems: StrategyItem[]
  memory?: MemoryContext
  feedback?: ZhugeFeedbackSummary
  maxActions?: number
  now?: Date
}

export interface WebsiteGrowthMeasurement {
  metric_key: string
  scope: 'page' | 'domain' | 'query'
  success_direction: 'increase' | 'decrease'
  starts_after: 'published' | 'pr_merged'
}

export interface WebsiteGrowthAction extends PriorityAction {
  lane: WebsiteGrowthLane
  score: number
  suggestion_key: string
  learning_adjustment: number
  learning_reasons: string[]
  measurement: WebsiteGrowthMeasurement
}

export interface WebsiteGrowthPlan {
  agent: 'website_growth'
  client_id: string
  domain: string
  generated_at: string
  mode: 'proposal_only'
  baseline: {
    pages_scanned: number
    strategy_items_scanned: number
    broken_pages: number
    thin_commercial_pages: number
    pages_without_geo_block: number
  }
  learning: {
    memory_loaded: boolean
    feedback_events_sampled: number
    suppressed_suggestions: number
  }
  actions: WebsiteGrowthAction[]
  guardrails: string[]
}
