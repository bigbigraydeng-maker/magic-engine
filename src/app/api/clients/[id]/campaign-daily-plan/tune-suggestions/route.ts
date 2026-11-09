/**
 * GET /api/clients/[id]/campaign-daily-plan/tune-suggestions?campaign_id=<uuid>
 *
 * Gate B 步骤 3 —— 读侧路由。把 flywheel_actions（同客户 + 同活动 + daily_plan）与它们
 * 的 T+72 receipt 一次性拉齐，交给 evaluateCampaignPosts fan-out 出建议 map，
 * 供 CampaignDailyPublishPanel 在每条已发布帖子下渲染。
 *
 * 边界：
 *   - 只读，不动数据、不发帖、不排期、不调 provider、不发 Inngest 事件。
 *   - Isolation：`requireDashboardClientAccess`（与其它 daily-plan 读路由一致）。
 *     参数里的 `campaign_id` 只用于 `flywheel_actions.payload->>campaign_id` 过滤，
 *     `client_id` 用 URL 里 `params.id`，不接受请求方声称的 client。
 *   - Fail-closed：任一 DB 读失败返回 500；无匹配 action 返回 `suggestions: {}`。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { evaluateCampaignPosts, type CampaignActionRow, type CampaignReceiptRow } from '@/lib/flywheel/tune/campaign-tune-suggestions'

const T72_WINDOW_HOURS = 72
const SOCIAL_PUBLISH_ACTION_TYPE = 'social.publish_post'
const DAILY_PLAN_SOURCE = 'daily_plan'
const ACTION_LIMIT = 50

interface ActionDbRow {
  id:      string
  payload: { idempotency_key?: unknown; [k: string]: unknown } | null
}

interface ReceiptDbRow {
  action_id:    string
  window_hours: number
  status:       string
  values:       unknown
  missing:      unknown
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get('campaign_id')
  if (!campaignId) {
    return NextResponse.json(
      { success: false, error: 'campaign_id is required' },
      { status: 400 },
    )
  }

  try {
    // Step 1: 拉候选 action。ACTION_LIMIT=50 ≈ 7 周节奏，足够本季的判定。
    const { data: actionsData, error: actionsError } = await supabaseAdmin
      .from('flywheel_actions')
      .select('id, payload')
      .eq('client_id',              clientId)
      .eq('action_type',            SOCIAL_PUBLISH_ACTION_TYPE)
      .eq('payload->>source',       DAILY_PLAN_SOURCE)
      .eq('payload->>campaign_id',  campaignId)
      .order('executed_at', { ascending: false, nullsFirst: false })
      .limit(ACTION_LIMIT)

    if (actionsError) throw new Error(`read flywheel_actions: ${actionsError.message}`)

    const rawActions = (actionsData ?? []) as ActionDbRow[]
    const actions: CampaignActionRow[] = []
    for (const r of rawActions) {
      // Keyed by idempotency_key, not post_id: a scheduled post's receipt holds
      // the photo id while its action row holds the resolved story id.
      const key = r.payload?.idempotency_key
      if (typeof key !== 'string' || key.length === 0) continue
      actions.push({ id: r.id, idempotencyKey: key })
    }

    if (actions.length === 0) {
      return NextResponse.json({
        success: true,
        suggestions: {},
        diagnostics: { candidateActionCount: 0, withT72ReceiptCount: 0 },
      })
    }

    // Step 2: 一次性拉这批 action 的 T+72 receipt。
    const actionIds = actions.map((a) => a.id)
    const { data: receiptsData, error: receiptsError } = await supabaseAdmin
      .from('social_post_measurement_receipts')
      .select('action_id, window_hours, status, values, missing')
      .in('action_id', actionIds)
      .eq('window_hours', T72_WINDOW_HOURS)

    if (receiptsError) throw new Error(`read social_post_measurement_receipts: ${receiptsError.message}`)

    const receiptRows = (receiptsData ?? []) as ReceiptDbRow[]
    const receipts: CampaignReceiptRow[] = receiptRows.map((r) => ({
      actionId:    r.action_id,
      windowHours: r.window_hours,
      status:      r.status,
      values:      r.values,
      missing:     r.missing,
    }))

    const suggestions = evaluateCampaignPosts({ actions, receipts })

    return NextResponse.json({
      success: true,
      suggestions,
      diagnostics: {
        candidateActionCount: actions.length,
        withT72ReceiptCount:  receipts.length,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { success: false, error: `tune-suggestions: ${message}` },
      { status: 500 },
    )
  }
}
