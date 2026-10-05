/** Staff-only O1 scale-up proposal: use the persisted finding, never request-supplied evidence. */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createKernel } from '@/lib/kernel'
import { ADS_O1_BUDGET_SCALE_ACTION_KEY, requireAdsO1BudgetScaleAccess, submitAdsO1BudgetScale } from '@/lib/action-submission/ads-o1-budget-scale'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { listAdSetsInCampaign } from '@/lib/meta/adsets'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }
const KNOWN_ADSET_STATUSES = new Set([
  'ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'PENDING_REVIEW', 'DISAPPROVED',
  'PREAPPROVED', 'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED',
  'IN_PROCESS', 'WITH_ISSUES', 'INACTIVE',
])

async function requireStaff(clientId: string) {
  const access = await requireAdsO1BudgetScaleAccess(clientId)
  if (!access.ok) return { response: NextResponse.json({ error: access.error }, { status: access.status }) }
  if (access.tier !== 'admin' || access.allowedClientId !== null || !access.user.email) {
    return { response: NextResponse.json({ error: '只有内部负责人可以提交或批准预算建议' }, { status: 403 }) }
  }
  return { access }
}

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireStaff(params.id)
  if (auth.response) return auth.response
  const { data, error } = await supabaseAdmin.from('action_runs')
    .select('id, status, input, evidence, rationale, authorization_decision_id, created_at, finished_at')
    .eq('client_id', params.id).eq('action_key', ADS_O1_BUDGET_SCALE_ACTION_KEY)
    .order('created_at', { ascending: false }).limit(20)
  if (error) return NextResponse.json({ error: '读取预算建议失败，请稍后再试' }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireStaff(params.id)
  if (auth.response) return auth.response
  const body = await req.json().catch(() => null) as { adset_id?: unknown } | null
  if (!body || typeof body.adset_id !== 'string' || !body.adset_id.trim()) {
    return NextResponse.json({ error: '缺少广告组编号' }, { status: 400 })
  }
  const adsetId = body.adset_id.trim()

  const { data: state, error: stateError } = await supabaseAdmin.from('ads_growth_states')
    .select('date, updated_at, data_completeness, payload').eq('client_id', params.id)
    .order('date', { ascending: false }).limit(1).maybeSingle()
  if (stateError) return NextResponse.json({ error: '暂时读不到最新检查结果' }, { status: 500 })
  const stateAge = state?.updated_at ? Date.now() - Date.parse(state.updated_at) : Number.NaN
  const reportDateAge = state?.date ? Date.now() - Date.parse(`${state.date}T00:00:00Z`) : Number.NaN
  if (!state || !Number.isFinite(stateAge) || stateAge < 0 || stateAge > 36 * 60 * 60 * 1000
    || !Number.isFinite(reportDateAge) || reportDateAge < -14 * 60 * 60 * 1000 || reportDateAge > 36 * 60 * 60 * 1000) {
    return NextResponse.json({ error: '最新 O1 检查已过期，请等待新一轮检查后再提交' }, { status: 409 })
  }
  const payload = state?.payload as { opportunities?: Array<{ code?: string; status?: string; units?: Array<{ id?: string; adAccountId?: string }>; evidence?: Record<string, unknown> }> } | null
  const finding = state?.data_completeness === 'complete'
    ? payload?.opportunities?.find(item => item.code === 'O1' && item.status === 'hit' && item.units?.some(unit => unit.id === adsetId))
    : undefined
  const unit = finding?.units?.find(item => item.id === adsetId)
  const adAccountId = unit?.adAccountId
  if (!finding || !adAccountId) {
    return NextResponse.json({ error: '这条 O1 建议已过期、数据不全，或不属于该客户；请刷新检查结果' }, { status: 409 })
  }

  const { data: snapshot, error: snapshotError } = await supabaseAdmin.from('ad_entity_snapshots')
    .select('ad_account_id, daily_budget_minor, budget_level, effective_status, currency, campaign_id, captured_at')
    .eq('client_id', params.id).eq('platform', 'meta').eq('level', 'adset').eq('entity_id', adsetId)
    .order('captured_at', { ascending: false }).order('id', { ascending: true }).limit(1).maybeSingle()
  if (snapshotError) return NextResponse.json({ error: '暂时读不到广告组预算' }, { status: 500 })
  const snapshotAge = snapshot?.captured_at ? Date.now() - Date.parse(snapshot.captured_at) : Number.NaN
  if (!snapshot || !Number.isFinite(snapshotAge) || snapshotAge < 0 || snapshotAge > 24 * 60 * 60 * 1000
    || snapshot.ad_account_id !== adAccountId || snapshot.effective_status !== 'ACTIVE'
    || typeof snapshot.currency !== 'string' || !snapshot.currency.trim()
  ) {
    return NextResponse.json({ error: '当前广告组快照过期或广告组不符合条件；没有创建审批请求' }, { status: 409 })
  }

  let campaignId: string | undefined
  let budgetMinor: number | null = snapshot.daily_budget_minor
  let budgetCurrency: string | null = snapshot.currency
  // Adset snapshots never carry `cbo`: normalizeAdset stores null when the
  // budget belongs to its parent campaign. Confirm CBO on that campaign row.
  if (snapshot.budget_level === null && snapshot.campaign_id) {
    campaignId = snapshot.campaign_id ?? undefined
    if (!campaignId || !/^\d{1,32}$/.test(campaignId)) {
      return NextResponse.json({ error: '系列预算所属关系无法确认；没有创建审批请求' }, { status: 409 })
    }
    const { data: campaign, error: campaignError } = await supabaseAdmin.from('ad_entity_snapshots')
      .select('ad_account_id, daily_budget_minor, budget_level, effective_status, currency, captured_at')
      .eq('client_id', params.id).eq('platform', 'meta').eq('level', 'campaign').eq('entity_id', campaignId)
      .eq('captured_at', snapshot.captured_at).order('id', { ascending: true }).limit(1).maybeSingle()
    if (campaignError) return NextResponse.json({ error: '暂时读不到广告系列预算' }, { status: 500 })
    if (!campaign || campaign.ad_account_id !== adAccountId || campaign.budget_level !== 'cbo'
      || campaign.effective_status !== 'ACTIVE' || typeof campaign.currency !== 'string'
      || !campaign.currency.trim() || campaign.currency !== snapshot.currency) {
      return NextResponse.json({ error: '广告系列预算快照过期或归属不一致；没有创建审批请求' }, { status: 409 })
    }
    const token = await getMetaTokenForClient(params.id)
    if (!token) return NextResponse.json({ error: '暂时无法读取 Meta 系列下的广告组状态' }, { status: 409 })
    // Stored setting snapshots are incremental, so unchanged children may not
    // have a row for this round. Read the complete live list; the helper returns
    // null if any Meta page fails or its cursor cannot be trusted.
    const siblings = await listAdSetsInCampaign(campaignId, token)
    if (!siblings) return NextResponse.json({ error: '无法完整读取该系列下的广告组，未创建审批请求' }, { status: 409 })
    if (siblings.some(row => row.account_id !== adAccountId.replace(/^act_/, '')
      || !KNOWN_ADSET_STATUSES.has(row.effective_status ?? ''))) {
      return NextResponse.json({ error: '该系列有广告组归属或投放状态无法确认，未创建审批请求' }, { status: 409 })
    }
    const deliveringChildren = siblings.filter(row => DELIVERING_STATUSES.has(row.effective_status ?? ''))
    if (deliveringChildren.length !== 1 || deliveringChildren[0]?.id !== adsetId) {
      return NextResponse.json({ error: '该系列还有其他在投广告组，不能仅凭这一组的表现提高整个系列预算' }, { status: 409 })
    }
    budgetMinor = campaign.daily_budget_minor
    budgetCurrency = campaign.currency
  } else if (snapshot.budget_level !== 'abo') {
    return NextResponse.json({ error: '广告组预算层级无法确认；没有创建审批请求' }, { status: 409 })
  }

  const before = Number(budgetMinor)
  if (!Number.isSafeInteger(before) || before <= 0) {
    return NextResponse.json({ error: '当前日预算无效；没有创建审批请求' }, { status: 409 })
  }
  const after = Math.round(before * 1.2)
  if (!Number.isSafeInteger(after) || after <= before) return NextResponse.json({ error: '预算金额不适合安全调整' }, { status: 409 })

  const { data: goal, error: goalError } = await supabaseAdmin.from('goals').select('id')
    .eq('client_id', params.id).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (goalError) return NextResponse.json({ error: '暂时读不到当前增长目标' }, { status: 500 })
  if (!goal) return NextResponse.json({ error: '该客户还没有生效中的增长目标，暂不能提交预算建议' }, { status: 409 })

  const now = new Date().toISOString()
  const { data: policy, error: policyError } = await supabaseAdmin.from('client_automation_policies')
    .select('id').eq('client_id', params.id).eq('action_key', ADS_O1_BUDGET_SCALE_ACTION_KEY)
    .eq('mode', 'require_approval').lte('effective_from', now)
    .or(`effective_to.is.null,effective_to.gt.${now}`).order('effective_from', { ascending: false }).limit(1).maybeSingle()
  if (policyError) return NextResponse.json({ error: '暂时无法核对预算审批规则' }, { status: 500 })
  if (!policy) return NextResponse.json({ error: '该客户还没有为这项预算调整设置“必须人工批准”的规则，未创建请求' }, { status: 409 })

  const outcome = await submitAdsO1BudgetScale(createKernel(supabaseAdmin), {
    clientId: params.id,
    access: auth.access,
    goalId: goal.id,
    cycleDate: state.date,
    adAccountId,
    adsetId,
    ...(campaignId ? { campaignId } : {}),
    beforeCents: before,
    afterCents: after,
    evidence: { date: state.date, currency: budgetCurrency, target_level: campaignId ? 'campaign' : 'adset', o1: finding.evidence ?? {} },
  })
  if (outcome.kind !== 'pending_approval') {
    return NextResponse.json({ error: outcome.humanReason ?? '系统没有建立待审批请求', kind: outcome.kind, runId: outcome.run.id }, { status: 409 })
  }
  return NextResponse.json({ ok: true, runId: outcome.run.id, decisionId: outcome.run.authorization_decision_id, beforeCents: before, afterCents: after }, { status: 202 })
}
