/**
 * P21.5 — 量产编排器 + production_packages 聚合
 *
 * runProductionBatch():
 *   把 P21.1-4 的积木串成端到端量产闭环：
 *     1. 建 production_package（status='generating'）
 *     2. fanOutToPlatforms：一主题 → N 平台变体（Sonnet 策略已烘焙在记忆里，Haiku 生产）
 *     3. 每个成功变体落 content_posts → production_items(content_post) → 回链
 *     4. finalize package：有产物 → 'ready_for_review'，全失败 → 'failed'；
 *        写 generation_context_snapshot（主题/平台/模型/成本聚合，可追溯不漂移）
 *
 * MTC 逐服务扣费 + 月度预算熔断属 P21.6，本编排器只暴露成本聚合面，不在此扣费。
 * supabaseAdmin 由调用方注入（route handler），不在模块顶层初始化（CLAUDE.md 约定）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fanOutToPlatforms } from './fan-out'
import type { FanOutResult, PlatformFanOutResult } from './fan-out'
import type { SupportedPlatform, ContentType } from './types'
import type { FlywheelName } from '@/lib/memory/types'
import type { MasterBrief, CampaignBrief } from '@/types/magic-engine'

// AI Factory 产出的社媒帖子复用 route_c（短视频/素材驱动社媒路由）；
// 真实出处 'ai_factory' 记录在 package 的 source_payload / snapshot 里。
const FACTORY_CONTENT_ROUTE = 'route_c'

// 量产编排器产出的包固定挂 social 维度（MVP：扇出对象都是社媒帖子）。
const FACTORY_PACKAGE_DIMENSION = 'social'

export interface ProductionBatchInput {
  clientId: string
  /** 内容主题/关键词，必填 */
  topic: string
  /** 目标平台，默认全部 5 个 */
  platforms?: SupportedPlatform[]
  /** 内容类型，默认 'post' */
  contentType?: ContentType
  /** 生产包标题，默认由主题派生 */
  packageTitle?: string
  masterBrief?: MasterBrief | null
  campaignBrief?: CampaignBrief | null
  fdeNote?: string
  flywheel?: FlywheelName
  /** 可选：关联到触发本批次的 marketing plan / campaign */
  marketingPlanId?: string
  campaignId?: string
}

export interface ProductionBatchItem {
  platform: SupportedPlatform
  contentPostId: string
  productionItemId: string
}

export interface ProductionBatchResult {
  packageId: string
  status: 'ready_for_review' | 'failed'
  items: ProductionBatchItem[]
  /** 扇出但落库失败 / 平台生成失败的明细 */
  failures: { platform: SupportedPlatform; error: string }[]
  successCount: number
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
}

export async function runProductionBatch(
  supabase: SupabaseClient,
  input: ProductionBatchInput,
): Promise<ProductionBatchResult> {
  const masterBriefId = await resolveMasterBriefId(supabase, input)

  // 1. 建包（generating）—— 失败直接抛，调用方按 500 处理
  const packageId = await createPackage(supabase, input, masterBriefId)

  // 2. 扇出（单平台失败不阻断整批）
  const fanOut = await fanOutToPlatforms(supabase, {
    clientId:      input.clientId,
    topic:         input.topic,
    platforms:     input.platforms,
    contentType:   input.contentType,
    masterBrief:   input.masterBrief,
    campaignBrief: input.campaignBrief,
    fdeNote:       input.fdeNote,
    flywheel:      input.flywheel,
  })

  // 3. 落库每个成功平台的变体
  const { items, failures } = await persistVariants(
    supabase,
    input.clientId,
    packageId,
    masterBriefId,
    fanOut,
  )

  // 4. finalize package
  const status: ProductionBatchResult['status'] =
    items.length > 0 ? 'ready_for_review' : 'failed'

  await finalizePackage(supabase, packageId, status, input, fanOut)

  return {
    packageId,
    status,
    items,
    failures,
    successCount:      items.length,
    totalCostUsd:      fanOut.totalCostUsd,
    totalInputTokens:  fanOut.totalInputTokens,
    totalOutputTokens: fanOut.totalOutputTokens,
  }
}

// ── Steps ───────────────────────────────────────────────────────────────────

async function resolveMasterBriefId(
  supabase: SupabaseClient,
  input: ProductionBatchInput,
): Promise<string> {
  const { data, error } = await supabase
    .from('master_briefs')
    .select('id')
    .eq('client_id', input.clientId)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`查询客户 Master Brief 失败: ${error.message}`)
  }
  if (!data?.id) {
    throw new Error('该客户尚未建立 Master Brief，无法量产')
  }
  return data.id as string
}

async function createPackage(
  supabase: SupabaseClient,
  input: ProductionBatchInput,
  masterBriefId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('production_packages')
    .insert({
      client_id:         input.clientId,
      master_brief_id:   masterBriefId,
      marketing_plan_id: input.marketingPlanId ?? null,
      campaign_id:       input.campaignId ?? null,
      dimension:         FACTORY_PACKAGE_DIMENSION,
      title:             input.packageTitle?.trim() || `AI 工厂量产 — ${input.topic}`,
      brief:             null,
      status:            'generating',
      source_payload:    { origin: 'ai_factory', topic: input.topic },
      generation_context_snapshot: {},
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    throw new Error(`创建生产包失败: ${error?.message ?? 'no row returned'}`)
  }
  return data.id as string
}

async function persistVariants(
  supabase: SupabaseClient,
  clientId: string,
  packageId: string,
  masterBriefId: string,
  fanOut: FanOutResult,
): Promise<{
  items: ProductionBatchItem[]
  failures: { platform: SupportedPlatform; error: string }[]
}> {
  const items: ProductionBatchItem[] = []
  const failures: { platform: SupportedPlatform; error: string }[] = []
  let sortOrder = 0

  for (const r of fanOut.results) {
    if (!r.result) {
      failures.push({ platform: r.platform, error: r.error ?? 'generation failed' })
      continue
    }

    try {
      const item = await persistOneVariant(
        supabase,
        clientId,
        packageId,
        masterBriefId,
        r,
        sortOrder,
      )
      items.push(item)
      sortOrder += 1
    } catch (err) {
      failures.push({
        platform: r.platform,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { items, failures }
}

async function persistOneVariant(
  supabase: SupabaseClient,
  clientId: string,
  packageId: string,
  masterBriefId: string,
  fanOutItem: PlatformFanOutResult,
  sortOrder: number,
): Promise<ProductionBatchItem> {
  const result = fanOutItem.result!
  const variant = result.variants[0]
  const caption = variant?.content ?? ''
  const hashtags = variant?.hashtags ?? []

  // 3a. content_posts 行
  const { data: post, error: postErr } = await supabase
    .from('content_posts')
    .insert({
      client_id:       clientId,
      title:           result.topic,
      route:           FACTORY_CONTENT_ROUTE,
      platforms:       [result.platform],
      caption,
      hashtags,
      source_brief_id: masterBriefId,
      status:          'draft',
    })
    .select('id')
    .single()

  if (postErr || !post?.id) {
    throw new Error(`content_posts 落库失败: ${postErr?.message ?? 'no row'}`)
  }
  const contentPostId = post.id as string

  // 3b. production_items 行（content_type='content_post'，CHECK 要求仅 content_post_id 非空）
  const { data: itemRow, error: itemErr } = await supabase
    .from('production_items')
    .insert({
      package_id:      packageId,
      client_id:       clientId,
      content_type:    'content_post',
      content_post_id: contentPostId,
      sort_order:      sortOrder,
      status:          'ready',
    })
    .select('id')
    .single()

  if (itemErr || !itemRow?.id) {
    throw new Error(`production_items 落库失败: ${itemErr?.message ?? 'no row'}`)
  }
  const productionItemId = itemRow.id as string

  // 3c. 回链 content_posts.production_item_id（best-effort，不阻断）
  await supabase
    .from('content_posts')
    .update({ production_item_id: productionItemId })
    .eq('id', contentPostId)

  return { platform: result.platform, contentPostId, productionItemId }
}

async function finalizePackage(
  supabase: SupabaseClient,
  packageId: string,
  status: ProductionBatchResult['status'],
  input: ProductionBatchInput,
  fanOut: FanOutResult,
): Promise<void> {
  const modelUsed = fanOut.results.find(r => r.result)?.result?.modelUsed ?? null

  await supabase
    .from('production_packages')
    .update({
      status,
      generation_context_snapshot: {
        origin:             'ai_factory',
        topic:              input.topic,
        platforms:          fanOut.platforms,
        content_type:       input.contentType ?? 'post',
        model_used:         modelUsed,
        success_count:      fanOut.successCount,
        total_cost_usd:     fanOut.totalCostUsd,
        total_input_tokens: fanOut.totalInputTokens,
        total_output_tokens: fanOut.totalOutputTokens,
        generated_at:       fanOut.generatedAt,
      },
    })
    .eq('id', packageId)
}
