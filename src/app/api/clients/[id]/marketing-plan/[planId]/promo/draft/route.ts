/**
 * POST /api/clients/[id]/marketing-plan/[planId]/promo/draft
 * 广告起草：根据账户事实 + 行业剧本，生成一条广告步骤的草稿建议。
 *
 * 为什么是 POST 却不写库：
 *   起草需要带参数（ad_account_id / other_steps：同阶段其它广告步骤），GET 不适合携带请求体；
 *   但整个流程是纯只读的——只读账户事实、只算建议，不落库、不改计划。
 *   PM 点「采纳」后草稿才进表单，保存仍走原来的 PUT 接口。
 *
 * 为什么不上 Inngest：
 *   纯同步只读、无外部副作用、无长耗时任务，属于 CLAUDE.md §3 的例外情形，
 *   直接在请求内同步完成即可，不需要异步编排。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { loadOwnedAccounts } from '@/lib/marketing-plan/promo/facts'
import { resolvePromoPlaybook } from '@/lib/marketing-plan/promo/playbooks'
import { loadAdsDraftFacts } from '@/lib/ads-strategy/promo-draft-facts'
import { draftAdsStep } from '@/lib/marketing-plan/promo/draft-ads'
import { requireBookingAccess } from '@/lib/crm/booking-access'

export async function POST(req: NextRequest, { params }: { params: { id: string; planId: string } }) {
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { ad_account_id?: string; other_steps?: { ad_account_id?: unknown; daily_budget_cents?: unknown }[] }

    const adAccountId = typeof body.ad_account_id === 'string' ? body.ad_account_id.trim() : ''
    if (!adAccountId) {
      return NextResponse.json({ success: false, error: '缺少广告账户' }, { status: 400 })
    }

    // 同一阶段里其它广告步骤已占用的日预算：同账户的扣账户上限，所有账户的都扣客户总上限
    const others = body.other_steps ?? []
    if (!Array.isArray(others) || others.length > 50) {
      return NextResponse.json({ success: false, error: 'other_steps 不合法' }, { status: 400 })
    }
    let committedMinor = 0
    let committedAllMinor = 0
    for (const o of others) {
      const cents = o?.daily_budget_cents
      if (typeof o?.ad_account_id !== 'string' || !Number.isSafeInteger(cents) || (cents as number) < 0) {
        return NextResponse.json({ success: false, error: 'other_steps 不合法' }, { status: 400 })
      }
      committedAllMinor += cents as number
      if (o.ad_account_id === adAccountId) committedMinor += cents as number
    }

    const { data: plan } = await supabaseAdmin
      .from('marketing_plans')
      .select('id, status, client_id, plan_data')
      .eq('id', params.planId)
      .eq('client_id', params.id)
      .maybeSingle<{ id: string; status: string; client_id: string; plan_data: unknown }>()
    if (!plan) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    }
    if (plan.status !== 'draft') {
      return NextResponse.json({ success: false, error: '只有草稿计划可以起草' }, { status: 409 })
    }

    const owned = await loadOwnedAccounts(params.id)
    if (owned === null) {
      return NextResponse.json({ success: false, error: '读不到这个客户的广告账户，稍后重试' }, { status: 503 })
    }
    if (!owned.some(a => a.id === adAccountId)) {
      return NextResponse.json({ success: false, error: '这个广告账户不属于这个客户' }, { status: 400 })
    }

    // 行业剧本：读不到行业就按 null 处理，由 resolvePromoPlaybook 兜底
    let industry: string | null = null
    try {
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('industry')
        .eq('id', params.id)
        .maybeSingle<{ industry: string | null }>()
      industry = client?.industry ?? null
    } catch {
      industry = null
    }
    const playbook = resolvePromoPlaybook(industry)

    // CRM-derived creative context is loaded only for users already allowed to
    // view this client's booking tracker. A denied check leaves the original
    // approved-pool order and the rest of the draft untouched.
    let companyConfirmedBookingsAllowed = false
    try {
      companyConfirmedBookingsAllowed = (await requireBookingAccess(params.id, 'view')).ok
    } catch {
      companyConfirmedBookingsAllowed = false
    }

    const facts = await loadAdsDraftFacts({
      clientId: params.id,
      adAccountId,
      committedMinor,
      committedAllMinor,
      playbook,
      companyConfirmedBookingsAllowed,
    })
    const draft = draftAdsStep(facts)

    return NextResponse.json({
      success: true,
      draft,
      today: facts.today,
      insights_as_of: facts.insights_as_of,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
