/**
 * POST /api/clients/[id]/ai-factory/fan-out
 *
 * P21.8 — FDE 一键量产触发端点
 *
 * 接收主题 + 平台列表，调用 fanOutToPlatforms()，把每个平台的输出
 * 批量写入 content_posts（status='draft'），同时扣 MTC 费用。
 *
 * Body:
 *   topic           string   — 内容主题（必填）
 *   platforms       string[] — 目标平台，默认全部 5 个
 *   contentType     string   — 'post'|'caption'|'reel_script'|'blog_outline'|'ad_copy'，默认 'post'
 *   flywheel        string   — 飞轮归属，默认 'social'
 *   fdeNote         string   — FDE 追加指令（选填）
 *   campaignId      string   — 关联 campaign（选填）
 *   executionItemId string   — 关联执行项（选填）
 *
 * Returns:
 *   { success, generated, saved, posts[], totalCostUsd, totalInputTokens, totalOutputTokens, failedPlatforms[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { fanOutToPlatforms, type FanOutInput } from '@/lib/ai-factory'
import { deductMtc } from '@/lib/mtc/deduct'
import { checkFactoryBudget } from '@/lib/mtc/factory-budget'
import type { SupportedPlatform, ContentType } from '@/lib/ai-factory'

const VALID_PLATFORMS: SupportedPlatform[] = ['facebook', 'instagram', 'linkedin', 'tiktok', 'google']
const VALID_CONTENT_TYPES: ContentType[]   = ['post', 'caption', 'reel_script', 'blog_outline', 'ad_copy']

type RouteContext = { params: { id: string } }

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  if (!topic) {
    return NextResponse.json({ success: false, error: 'topic 不能为空' }, { status: 400 })
  }

  // Validate + allowlist platforms
  const rawPlatforms = Array.isArray(body.platforms) ? body.platforms : VALID_PLATFORMS
  const platforms = (rawPlatforms as unknown[])
    .filter((p): p is SupportedPlatform => VALID_PLATFORMS.includes(p as SupportedPlatform))
  if (platforms.length === 0) {
    return NextResponse.json({ success: false, error: '未提供有效的 platform' }, { status: 400 })
  }

  const contentType: ContentType =
    VALID_CONTENT_TYPES.includes(body.contentType as ContentType)
      ? (body.contentType as ContentType)
      : 'post'

  const flywheel        = typeof body.flywheel === 'string' ? body.flywheel : 'social'
  const fdeNote         = typeof body.fdeNote === 'string' ? body.fdeNote.trim() || undefined : undefined
  const campaignId      = typeof body.campaignId === 'string' && body.campaignId ? body.campaignId : null
  const executionItemId = typeof body.executionItemId === 'string' && body.executionItemId ? body.executionItemId : null

  // Load master brief + optional campaign brief for context injection
  const [{ data: masterBrief }, { data: campaignBrief }] = await Promise.all([
    supabaseAdmin
      .from('master_briefs')
      .select('*')
      .eq('client_id', clientId)
      .limit(1)
      .maybeSingle(),
    campaignId
      ? supabaseAdmin
          .from('campaign_briefs')
          .select('*')
          .eq('id', campaignId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // P21.6 — 月度预算熔断：提前检查本月消耗量，超限则 429
  const estimatedPosts = platforms.length   // 每平台 1 帖（默认 variants=1）
  const budget = await checkFactoryBudget(clientId, estimatedPosts)
  if (!budget.allowed) {
    return NextResponse.json({
      success: false,
      error:   `本月 AI Factory 已达上限（${budget.usedThisMonth}/${budget.limit} 帖）。请下月继续或联系 Magic Lab 提升配额。`,
      budget:  { used: budget.usedThisMonth, limit: budget.limit, remaining: budget.remaining },
    }, { status: 429 })
  }

  // Run fan-out (supabaseAdmin used server-side — no user session needed)
  const fanOutInput: FanOutInput = {
    clientId,
    topic,
    platforms,
    contentType,
    flywheel: flywheel as FanOutInput['flywheel'],
    masterBrief:   masterBrief   ?? null,
    campaignBrief: campaignBrief ?? null,
    fdeNote,
  }

  const fanOutResult = await fanOutToPlatforms(supabaseAdmin, fanOutInput)

  if (fanOutResult.successCount === 0) {
    const errors = fanOutResult.results
      .map(r => `${r.platform}: ${r.error ?? 'unknown'}`)
      .join('; ')
    return NextResponse.json(
      { success: false, error: `所有平台生成失败: ${errors}` },
      { status: 500 }
    )
  }

  // Build content_posts rows from successful results
  const rows = fanOutResult.results
    .filter(r => r.result !== null)
    .flatMap(r => {
      const result = r.result!
      return result.variants.map(variant => ({
        client_id:    clientId,
        campaign_id:  campaignId,
        platforms:    [r.platform],
        route:        'route_a',
        title:        `[AI Factory] ${topic} — ${r.platform}`,
        script:       null,
        caption:      variant.content,
        hashtags:     variant.hashtags,
        visual_brief: null,
        content_mode: 'campaign',   // content_posts CHECK: 'brand'|'campaign'
        status:       'draft',
        quality_score: null,
        generation_context_snapshot: {
          factory_job_id:    result.jobId,
          model_used:        result.modelUsed,
          memory_injected:   result.memoryInjected,
          input_tokens:      result.inputTokens,
          output_tokens:     result.outputTokens,
          cost_usd:          result.costUsd,
          topic,
          content_type:      contentType,
          flywheel,
          fde_note:          fdeNote ?? null,
          generated_at:      result.generatedAt,
          execution_item_id: executionItemId,
        },
      }))
    })

  const { data: savedPosts, error: insertErr } = await supabaseAdmin
    .from('content_posts')
    .insert(rows)
    .select('id, title, caption, hashtags, platforms, status')

  if (insertErr) {
    console.error('[ai-factory/fan-out] DB insert error:', insertErr)
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 })
  }

  // Deduct MTC per saved post (non-blocking — failure doesn't fail the request)
  const savedCount = savedPosts?.length ?? 0
  if (savedCount > 0) {
    deductMtc(clientId, 'ai_factory_post', savedCount).catch(err =>
      console.error('[ai-factory/fan-out] MTC deduction error:', err)
    )
  }

  return NextResponse.json({
    success:           true,
    generated:         fanOutResult.successCount,
    saved:             savedCount,
    posts:             savedPosts ?? [],
    totalCostUsd:      fanOutResult.totalCostUsd,
    totalInputTokens:  fanOutResult.totalInputTokens,
    totalOutputTokens: fanOutResult.totalOutputTokens,
    failedPlatforms:   fanOutResult.results
      .filter(r => r.result === null)
      .map(r => r.platform),
  }, { status: 201 })
}
