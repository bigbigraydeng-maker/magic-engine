/** Staff-only O1 scale-up proposal: use the persisted finding, never request-supplied evidence. */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createKernel } from '@/lib/kernel'
import { ADS_O1_BUDGET_SCALE_ACTION_KEY, requireAdsO1BudgetScaleAccess, submitAdsO1BudgetScale } from '@/lib/action-submission/ads-o1-budget-scale'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { listAdSetsInCampaign } from '@/lib/meta/adsets'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { listSteps, getDecision } from '@/lib/kernel/store'
import { accountDayKey, accountYesterday, resolveAccountTimezone } from '@/lib/ads-strategy/account-timezone'
import {
  O1_BUDGET_FIRST_REVIEW_HOURS,
  O1_BUDGET_OUTCOME_WINDOW_DAYS,
  concludeO1BudgetObservation,
  resolveO1BudgetGoalMetric,
  shiftO1BudgetDate,
  sumO1BudgetMetricPeriod,
  type O1BudgetMetricPeriod,
  type O1BudgetMetricRow,
} from '@/lib/action-submission/ads-o1-budget-observation'

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
    .select('id, client_id, goal_id, action_key, status, input, evidence, rationale, authorization_decision_id, created_at, started_at, finished_at')
    .eq('client_id', params.id).eq('action_key', ADS_O1_BUDGET_SCALE_ACTION_KEY)
    .order('created_at', { ascending: false }).limit(20)
  if (error) return NextResponse.json({ error: '读取预算建议失败，请稍后再试' }, { status: 500 })
  const items = await Promise.all((data ?? []).map(async run => {
    const [steps, decision] = await Promise.all([
      listSteps(supabaseAdmin, run.id),
      run.authorization_decision_id ? getDecision(supabaseAdmin, run.authorization_decision_id) : Promise.resolve(null),
    ])
    const apply = steps.find(step => step.step_key === 'apply')
    const readback = steps.find(step => step.step_key === 'readback')
    const receipt = {
      apply: apply ? {
        status: apply.status,
        applied: apply.output.applied === true,
        target_id: apply.output.campaign_id ?? apply.output.adset_id ?? null,
        prior_daily_budget_cents: apply.output.prior_daily_budget_cents ?? null,
        new_daily_budget_cents: apply.output.new_daily_budget_cents ?? null,
        finished_at: apply.finished_at,
      } : null,
      readback: readback ? {
        status: readback.status,
        target_id: readback.output.campaign_id ?? readback.output.adset_id ?? null,
        daily_budget_now: readback.output.daily_budget_now ?? null,
        passed: readback.verification?.passed === true,
        checks: readback.verification?.checks ?? [],
        finished_at: readback.finished_at,
      } : null,
    }
    const evidence = run.evidence as Record<string, unknown>
    const expectedTargetId = typeof run.input.campaign_id === 'string' ? run.input.campaign_id : run.input.adset_id
    const expectedBefore = run.input.before_cents
    const expectedAfter = run.input.after_cents
    const receiptVerified = run.status === 'succeeded'
      && receipt.apply?.status === 'succeeded' && receipt.apply.applied
      && receipt.apply.target_id === expectedTargetId && receipt.readback?.target_id === expectedTargetId
      && typeof expectedBefore === 'number' && Number.isSafeInteger(expectedBefore)
      && receipt.apply.prior_daily_budget_cents === expectedBefore
      && typeof expectedAfter === 'number' && Number.isSafeInteger(expectedAfter)
      && receipt.apply.new_daily_budget_cents === expectedAfter
      && receipt.readback?.status === 'succeeded' && receipt.readback.passed
      && receipt.readback.daily_budget_now === expectedAfter
    const observation = await readO1BudgetObservation({
      clientId: params.id,
      run,
      evidence,
      receiptVerified,
      authorizationVerified: decision?.action_run_id === run.id && decision.client_id === params.id
        && decision.action_key === ADS_O1_BUDGET_SCALE_ACTION_KEY && decision.verdict === 'allow'
        && decision.decided_by === 'human',
    })
    return {
      ...run,
      approval: decision ? {
        verdict: decision.verdict,
        decided_by: decision.decided_by,
        decided_at: decision.created_at,
      } : null,
      receipt: { ...receipt, verified: receiptVerified },
      observation,
    }
  }))
  return NextResponse.json({ items })
}

type ObservationEvidence = {
  schema: 1
  metric_key: string | null
  metric_label: string | null
  target_direction: 'increase' | 'decrease' | null
  target_level: 'adset' | 'campaign'
  target_id: string
  ad_account_id: string
  timezone: string | null
  baseline: (O1BudgetMetricPeriod & { metric_key: string; captured_at: string }) | null
  baseline_unavailable_reason: string | null
}

async function readO1BudgetObservation(args: {
  clientId: string
  run: { id: string; client_id: string; action_key: string; status: string; input: Record<string, unknown>; finished_at: string | null }
  evidence: Record<string, unknown>
  receiptVerified: boolean
  authorizationVerified: boolean
}) {
  const saved = args.evidence.budget_observation as ObservationEvidence | undefined
  const finish = args.run.finished_at
  if (!saved || saved.schema !== 1 || !finish || args.run.client_id !== args.clientId
    || args.run.action_key !== ADS_O1_BUDGET_SCALE_ACTION_KEY) {
    return { conclusion: 'continue_observing', reason: '缺少可核实的专属观察证据；不作效果结论。' }
  }
  const input = args.run.input
  const expectedTarget = saved.target_level === 'campaign' ? input.campaign_id : input.adset_id
  const targetMatches = args.authorizationVerified && input.ad_account_id === saved.ad_account_id
    && expectedTarget === saved.target_id
  const metric = saved.metric_key ? resolveO1BudgetGoalMetric(saved.metric_key) : null
  const finishDate = accountDayKey(saved.timezone, new Date(finish))
  const afterStart = shiftO1BudgetDate(finishDate, 1)
  const afterEnd = shiftO1BudgetDate(afterStart, O1_BUDGET_OUTCOME_WINDOW_DAYS - 1)
  const today = saved.timezone ? accountDayKey(saved.timezone, new Date()) : ''
  const windowComplete = !!saved.timezone && today > afterEnd
  const baselineAt = saved.baseline?.captured_at ? Date.parse(saved.baseline.captured_at) : Number.NaN
  const finishedAt = Date.parse(finish)
  const baselineFresh = !saved.baseline || (Number.isFinite(baselineAt) && baselineAt <= finishedAt
    && finishedAt - baselineAt <= 36 * 60 * 60 * 1000)
  let after: O1BudgetMetricPeriod | null = null
  if (windowComplete && metric && targetMatches) {
    const { data, error } = await supabaseAdmin.from('ad_daily_insights')
      .select('insight_date, leads, messaging_conversations')
      .eq('client_id', args.clientId).eq('ad_account_id', saved.ad_account_id).eq('platform', 'meta')
      .eq('level', saved.target_level).eq('entity_id', saved.target_id)
      .gte('insight_date', afterStart).lte('insight_date', afterEnd)
      .order('insight_date', { ascending: true })
    if (!error && data) after = sumO1BudgetMetricPeriod(data as O1BudgetMetricRow[], metric, afterStart, afterEnd)
  }

  const snapshotHistoryQuery = supabaseAdmin.from('ad_entity_snapshots')
    .select('ad_account_id, daily_budget_minor, captured_at')
    .eq('client_id', args.clientId).eq('platform', 'meta').eq('ad_account_id', saved.ad_account_id)
    .eq('level', saved.target_level).eq('entity_id', saved.target_id)
    .gte('captured_at', finish).lte('captured_at', new Date().toISOString())
    .order('captured_at', { ascending: true })
  const { data: budgetSnapshots, error: snapshotError } = targetMatches
    ? await snapshotHistoryQuery
    : { data: null, error: null }
  const snapshots = (budgetSnapshots ?? []) as Array<{ ad_account_id: string; daily_budget_minor: number | string | null; captured_at: string }>
  const currentSnapshot = snapshots[snapshots.length - 1] ?? null
  const snapshotAt = currentSnapshot?.captured_at ? Date.parse(currentSnapshot.captured_at) : Number.NaN
  const snapshotAge = Date.now() - snapshotAt
  const allObservedBudgetsMatch = snapshots.length > 0 && snapshots.every(snapshot =>
    snapshot.ad_account_id === saved.ad_account_id
    && Number.isFinite(Date.parse(snapshot.captured_at))
    && Date.parse(snapshot.captured_at) >= Date.parse(finish)
    && Number(snapshot.daily_budget_minor) === Number(input.after_cents))
  const budgetMatchesThisRun = !snapshotError && allObservedBudgetsMatch && !!currentSnapshot
    && currentSnapshot.ad_account_id === saved.ad_account_id
    && Number.isFinite(snapshotAt) && snapshotAt >= Date.parse(finish) && snapshotAge >= 0 && snapshotAge <= 24 * 60 * 60 * 1000

  const firstReviewAt = new Date(Date.parse(finish) + O1_BUDGET_FIRST_REVIEW_HOURS * 60 * 60 * 1000).toISOString()
  const conclusion = args.run.status === 'succeeded'
    ? concludeO1BudgetObservation({
      baseline: saved.baseline,
      after,
      metric,
      targetDirection: saved.target_direction,
      baselineFresh,
      now: new Date(),
      firstReviewAt,
      windowComplete,
      receiptVerified: args.receiptVerified && targetMatches,
      budgetMatchesThisRun,
    })
    : { conclusion: 'continue_observing' as const, reason: `执行状态为 ${args.run.status}，没有成功回执，不作效果结论。`, delta: null, deltaPct: null, confidence: null }

  return {
    ...conclusion,
    metric_key: saved.metric_key,
    metric_label: saved.metric_label,
    target_id: saved.target_id,
    target_level: saved.target_level,
    timezone: saved.timezone,
    baseline: saved.baseline,
    after,
    first_review_at: firstReviewAt,
    window_start: afterStart,
    window_end: afterEnd,
    window_complete: windowComplete,
    budget_snapshot_at: currentSnapshot?.captured_at ?? null,
    budget_matches_this_run: budgetMatchesThisRun,
    baseline_unavailable_reason: saved.baseline_unavailable_reason
      ?? (baselineFresh ? null : '执行前 KPI 基线已超出 O1 现有 36 小时新鲜度窗口。'),
  }
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

  const { data: goal, error: goalError } = await supabaseAdmin.from('goals')
    .select('id, primary_metric_key, primary_metric_label, target_direction')
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

  const observationMetric = resolveO1BudgetGoalMetric(goal.primary_metric_key)
  const observationTimezone = await resolveAccountTimezone(adAccountId)
  const baselineEnd = observationTimezone ? accountYesterday(observationTimezone, new Date()) : null
  const baselineStart = baselineEnd ? shiftO1BudgetDate(baselineEnd, -(O1_BUDGET_OUTCOME_WINDOW_DAYS - 1)) : null
  let baseline: O1BudgetMetricPeriod | null = null
  let baselineUnavailableReason: string | null = null
  if (!observationMetric) baselineUnavailableReason = `目标 KPI「${goal.primary_metric_key}」没有已验证的广告日指标映射。`
  else if (!observationTimezone || !baselineStart || !baselineEnd) baselineUnavailableReason = '广告账户时区未知，无法安全确定调整前的完整日数据窗口。'
  else {
    const entityId = campaignId ?? adsetId
    const level = campaignId ? 'campaign' : 'adset'
    const { data: metricRows, error: metricError } = await supabaseAdmin.from('ad_daily_insights')
      .select('insight_date, leads, messaging_conversations')
      .eq('client_id', params.id).eq('ad_account_id', adAccountId).eq('platform', 'meta')
      .eq('level', level).eq('entity_id', entityId)
      .gte('insight_date', baselineStart).lte('insight_date', baselineEnd)
      .order('insight_date', { ascending: true })
    if (!metricError && metricRows) baseline = sumO1BudgetMetricPeriod(metricRows as O1BudgetMetricRow[], observationMetric, baselineStart, baselineEnd)
    if (!baseline) baselineUnavailableReason = metricError ? '读取调整前目标 KPI 日数据失败。' : '调整前 14 天目标 KPI 日数据不完整。'
  }
  const observationEvidence: ObservationEvidence = {
    schema: 1,
    metric_key: observationMetric?.key ?? null,
    metric_label: observationMetric ? `${goal.primary_metric_label}（${observationMetric.label}）` : goal.primary_metric_label,
    target_direction: goal.target_direction === 'increase' || goal.target_direction === 'decrease' ? goal.target_direction : null,
    target_level: campaignId ? 'campaign' : 'adset',
    target_id: campaignId ?? adsetId,
    ad_account_id: adAccountId,
    timezone: observationTimezone,
    baseline: baseline && observationMetric ? { ...baseline, metric_key: observationMetric.key, captured_at: new Date().toISOString() } : null,
    baseline_unavailable_reason: baselineUnavailableReason,
  }

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
    evidence: {
      date: state.date, currency: budgetCurrency, target_level: campaignId ? 'campaign' : 'adset', o1: finding.evidence ?? {},
      budget_observation: observationEvidence,
    },
  })
  if (outcome.kind !== 'pending_approval') {
    return NextResponse.json({ error: outcome.humanReason ?? '系统没有建立待审批请求', kind: outcome.kind, runId: outcome.run.id }, { status: 409 })
  }
  return NextResponse.json({ ok: true, runId: outcome.run.id, decisionId: outcome.run.authorization_decision_id, beforeCents: before, afterCents: after }, { status: 202 })
}
