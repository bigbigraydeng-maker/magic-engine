/**
 * POST /api/clients/[id]/ai-factory/fan-out
 *
 * P21.5+P21.8 — FDE 一键量产触发端点
 *
 * 调用 runProductionBatch()，走完整聚合路线：
 *   建 production_package(generating) → 扇出 → 落 content_posts + production_items
 *   → finalize(ready_for_review) → 扣 MTC
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
 *   { success, packageId, status, successCount, items[], failures[], totalCostUsd, budget }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { runProductionBatch } from '@/lib/ai-factory'
import { deductMtc } from '@/lib/mtc/deduct'
import { checkBudget } from '@/lib/mtc/budget-guard'
import type { SupportedPlatform, ContentType } from '@/lib/ai-factory'

const VALID_PLATFORMS: SupportedPlatform[] = ['facebook', 'instagram', 'linkedin', 'tiktok', 'google']
const VALID_CONTENT_TYPES: ContentType[]   = ['post', 'caption', 'reel_script', 'blog_outline', 'ad_copy']

const MTC_PER_POST = 5   // ai_factory_post = 5 MTC（与 MTC_RATES 一致）

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
  const campaignId      = typeof body.campaignId === 'string' && body.campaignId ? body.campaignId : undefined
  const executionItemId = typeof body.executionItemId === 'string' && body.executionItemId ? body.executionItemId : undefined

  // P21.6 — 月度预算熔断（MTC 金额上限）
  const estimatedMtc = platforms.length * MTC_PER_POST
  const budget = await checkBudget(clientId, estimatedMtc)
  if (!budget.allowed) {
    return NextResponse.json({
      success: false,
      error:   `本月 AI Factory 预算已达上限（已用 ${budget.spent}/${budget.cap} MTC）。请下月继续或联系 Magic Lab 提升配额。`,
      budget:  { spent: budget.spent, cap: budget.cap, remaining: budget.remaining },
    }, { status: 429 })
  }

  // 加载 master brief + campaign brief（注入量产编排器）
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

  // P21.5 — runProductionBatch：建包 → 扇出 → 落库 → finalize
  let batchResult
  try {
    batchResult = await runProductionBatch(supabaseAdmin, {
      clientId,
      topic,
      platforms,
      contentType,
      flywheel:      flywheel as Parameters<typeof runProductionBatch>[1]['flywheel'],
      masterBrief:   masterBrief   ?? null,
      campaignBrief: campaignBrief ?? null,
      fdeNote,
      campaignId,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }

  // 扣 MTC（非阻断，按实际落库帖数 × 单价扣）
  if (batchResult.successCount > 0) {
    deductMtc(clientId, 'ai_factory_post', batchResult.successCount * MTC_PER_POST).catch(e =>
      console.error('[ai-factory/fan-out] MTC deduction error:', e)
    )
  }

  // 如果有 executionItemId，更新关联执行项的 production_package_id（best-effort, fire-and-forget）
  if (executionItemId && batchResult.packageId) {
    void supabaseAdmin
      .from('execution_items')
      .update({ production_package_id: batchResult.packageId })
      .eq('id', executionItemId)
  }

  return NextResponse.json({
    success:           batchResult.successCount > 0,
    packageId:         batchResult.packageId,
    status:            batchResult.status,
    successCount:      batchResult.successCount,
    items:             batchResult.items,
    failures:          batchResult.failures,
    totalCostUsd:      batchResult.totalCostUsd,
    totalInputTokens:  batchResult.totalInputTokens,
    totalOutputTokens: batchResult.totalOutputTokens,
    budget:            { spent: budget.spent, cap: budget.cap, remaining: budget.remaining },
  }, { status: batchResult.successCount > 0 ? 201 : 500 })
}
