/**
 * P21.3 — 变体扇出引擎
 *
 * fanOutToPlatforms():
 *   给定一个主题，同时为多个平台并发生成内容。
 *   使用 Promise.allSettled 确保单平台失败不中断整批次。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { runFactoryJob } from './generator'
import type {
  FactoryJobInput,
  FactoryResult,
  SupportedPlatform,
  ContentType,
} from './types'
import type { FlywheelName } from '@/lib/memory/types'
import type { MasterBrief, CampaignBrief } from '@/types/magic-engine'

const ALL_PLATFORMS: SupportedPlatform[] = [
  'facebook',
  'instagram',
  'linkedin',
  'tiktok',
  'google',
]

export interface FanOutInput {
  clientId: string
  topic: string
  /** 目标平台列表，默认全部 5 个，重复值自动去重 */
  platforms?: SupportedPlatform[]
  /** 每个平台的内容类型，默认 'post' */
  contentType?: ContentType
  masterBrief?: MasterBrief | null
  campaignBrief?: CampaignBrief | null
  fdeNote?: string
  flywheel?: FlywheelName
}

export interface PlatformFanOutResult {
  platform: SupportedPlatform
  result: FactoryResult | null
  error?: string
}

export interface FanOutResult {
  topic: string
  platforms: SupportedPlatform[]
  results: PlatformFanOutResult[]
  successCount: number
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  generatedAt: string
}

export async function fanOutToPlatforms(
  supabase: SupabaseClient,
  input: FanOutInput,
): Promise<FanOutResult> {
  const platforms = dedup(input.platforms ?? ALL_PLATFORMS)
  const contentType = input.contentType ?? 'post'

  const settled = await Promise.allSettled(
    platforms.map(platform => {
      const jobInput: FactoryJobInput = {
        clientId:      input.clientId,
        platform,
        contentType,
        topic:         input.topic,
        flywheel:      input.flywheel,
        masterBrief:   input.masterBrief,
        campaignBrief: input.campaignBrief,
        fdeNote:       input.fdeNote,
        variants:      1,
      }
      return runFactoryJob(supabase, jobInput)
    }),
  )

  const results: PlatformFanOutResult[] = platforms.map((platform, i) => {
    const outcome = settled[i]
    if (outcome.status === 'fulfilled') {
      return { platform, result: outcome.value }
    }
    return {
      platform,
      result: null,
      error: outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason),
    }
  })

  const successCount       = results.filter(r => r.result !== null).length
  const totalCostUsd       = results.reduce((sum, r) => sum + (r.result?.costUsd ?? 0), 0)
  const totalInputTokens   = results.reduce((sum, r) => sum + (r.result?.inputTokens ?? 0), 0)
  const totalOutputTokens  = results.reduce((sum, r) => sum + (r.result?.outputTokens ?? 0), 0)

  return {
    topic: input.topic,
    platforms,
    results,
    successCount,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    generatedAt: new Date().toISOString(),
  }
}

function dedup<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}
