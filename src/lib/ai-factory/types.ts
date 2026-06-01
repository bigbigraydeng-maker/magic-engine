/**
 * P21.2 — AI Factory 服务层类型
 *
 * FactoryJobInput  → 单个量产任务入参
 * FactoryResult    → 单个量产任务产出
 * BatchJobInput    → 批量任务（P21.5 编排器用）
 */

import type { FlywheelName } from '@/lib/memory/types'
import type { MasterBrief, CampaignBrief } from '@/types/magic-engine'

export type ContentType =
  | 'post'          // 通用社媒帖子
  | 'caption'       // 图片配文
  | 'reel_script'   // Reels 脚本
  | 'blog_outline'  // 博客大纲
  | 'ad_copy'       // 广告文案

export type SupportedPlatform =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'tiktok'
  | 'google'        // Google Ads 文案

export interface FactoryJobInput {
  clientId: string
  platform: SupportedPlatform
  contentType: ContentType
  /** 内容主题/关键词，必填 */
  topic: string
  flywheel?: FlywheelName
  /** 可选：注入 Master Brief 品牌约束 */
  masterBrief?: MasterBrief | null
  /** 可选：注入 Campaign 运营方向 */
  campaignBrief?: CampaignBrief | null
  /** FDE 追加指令（如"强调限时优惠"）*/
  fdeNote?: string
  /** 期望生成的变体数量（1-5），默认 1 */
  variants?: number
  /**
   * Phase 22.C.2 — Pre-formatted Data Intelligence signal block.
   * Produced by loadIntelligenceContext() and injected into system prompt.
   * Optional — factory works fine without it.
   */
  intelligenceBlock?: string | null
}

export interface FactoryVariant {
  content: string
  hashtags: string[]
}

export interface FactoryResult {
  jobId: string
  clientId: string
  platform: SupportedPlatform
  contentType: ContentType
  topic: string
  variants: FactoryVariant[]
  /** 是否成功注入 L3 记忆 */
  memoryInjected: boolean
  /** 使用的模型 ID */
  modelUsed: string
  inputTokens: number
  outputTokens: number
  /** 本次调用 USD 成本 */
  costUsd: number
  generatedAt: string
}
