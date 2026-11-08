/**
 * 成绩单每行「加 10% / 加 20% / 减到 X」（第 3 刀 3b，设计稿 `docs/specs/2026-11-03-ads-knife3-spend-gate-and-budget-buttons-design.md` §3）。
 *
 *   GET  ?level=adset|campaign&unit_id=&ad_account_id=  → 预览（只读）
 *   POST { level, unit_id, ad_account_id, kind: 'up10'|'up20'|'down_to', target_cents?, request_id }
 *
 * 🔴 加：只提交、不执行。复用 O1 人批链路（强制要人批），批准只有 PM 本人（内核第 3 刀 3a 的闸）。
 *    加钱批准人名单没配 → 503，不提交（闸不在位不开按钮）。
 * 🔴 减：复用人工止损提交（刹车，管理员点了就执行），一次最多减 20%，服务端重算、不信前端数字。
 * 🔴 预览和提交都在服务端重读事实（最新成绩单、当场读 Meta、内核信封），不信请求体里的金额。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createKernel } from '@/lib/kernel'
import { requireAdsO1BudgetScaleAccess } from '@/lib/action-submission/ads-o1-budget-scale'
import { requireStopLossAccess } from '@/lib/action-submission/stop-loss'
import { clickerFromAccess, issueMoneyBudget } from '@/lib/action-submission/money-card'
import { loadMoneyBudgetLive } from '@/lib/action-submission/money-card-live'
import { resolveAccountTimezone, accountDayKey } from '@/lib/ads-strategy/account-timezone'
import { loadBudgetChange, type BudgetChangeUnit } from '@/lib/ads-strategy/budget-change/load'
import { validateReduceTarget } from '@/lib/ads-strategy/budget-change/plan'
import { assertCampaignOwnedByClient } from '@/lib/meta/campaign-ownership'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }
type Kind = 'up10' | 'up20' | 'down_to'

function parseUnit(level: unknown, unitId: unknown, adAccountId: unknown): BudgetChangeUnit | null {
  if (level !== 'adset' && level !== 'campaign') return null
  if (typeof unitId !== 'string' || !/^\d{1,32}$/.test(unitId)) return null
  if (typeof adAccountId !== 'string' || !/^(act_)?\d{1,32}$/.test(adAccountId)) return null
  return { level, id: unitId, adAccountId: actId(adAccountId) }
}

/** 广告账户编号统一带 act_ 前缀（快照、成绩单、内核输入都是这个写法）。 */
function actId(adAccountId: string): string {
  return adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
}

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await requireStopLossAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const q = req.nextUrl.searchParams
  const unit = parseUnit(q.get('level'), q.get('unit_id'), q.get('ad_account_id'))
  if (!unit) return NextResponse.json({ error: '缺少或填错了组的编号' }, { status: 400 })
  const loaded = await loadBudgetChange(supabaseAdmin, params.id, unit)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  return NextResponse.json({ plan: loaded.plan, target: loaded.target, spendGateReady: spendGateReady() })
}

/** 加钱批准人名单配了没有（第 3 刀 3a 的闸是否在位）。没配 = 谁都批不了，加的按钮不开。 */
function spendGateReady(): boolean {
  return (process.env.ADS_SPEND_APPROVER_EMAILS ?? '').split(',').some(e => e.trim() !== '')
}

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const unit = body ? parseUnit(body.level, body.unit_id, body.ad_account_id) : null
  const kind = body?.kind
  if (!body || !unit || (kind !== 'up10' && kind !== 'up20' && kind !== 'down_to')) {
    return NextResponse.json({ error: '请求内容不完整' }, { status: 400 })
  }
  return kind === 'down_to'
    ? submitReduce(params.id, unit, body.target_cents, body.request_id)
    : submitScale(params.id, unit, kind)
}

async function activeGoalId(clientId: string): Promise<{ id: string } | { error: NextResponse }> {
  const { data, error } = await supabaseAdmin.from('goals').select('id')
    .eq('client_id', clientId).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return { error: NextResponse.json({ error: '暂时读不到当前增长目标' }, { status: 500 }) }
  if (!data) return { error: NextResponse.json({ error: '这个客户还没有生效中的增长目标，暂时不能调预算' }, { status: 409 }) }
  return { id: (data as { id: string }).id }
}

async function submitScale(clientId: string, unit: BudgetChangeUnit, kind: Exclude<Kind, 'down_to'>): Promise<NextResponse> {
  const access = await requireAdsO1BudgetScaleAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.tier !== 'admin' || access.allowedClientId !== null || !access.user.email) {
    return NextResponse.json({ error: '只有内部负责人可以提交加预算' }, { status: 403 })
  }
  if (!spendGateReady()) return NextResponse.json({ error: '加钱的闸还没装好（批准人名单没配），暂时不能提交加预算' }, { status: 503 })
  const loaded = await loadBudgetChange(supabaseAdmin, clientId, unit)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const option = loaded.plan[kind]
  const before = loaded.plan.currentCents
  if (!option.allowed || option.afterCents === null || before === null || !loaded.target.scaleAdsetId) {
    return NextResponse.json({ error: option.reasons[0] ?? '现在不能加', reasons: option.reasons }, { status: 409 })
  }
  const goal = await activeGoalId(clientId)
  if ('error' in goal) return goal.error
  const issued = await issueScorecardCard(clientId, access, unit, {
    source: 'scorecard_up',
    entityId: unit.level === 'campaign' ? (loaded.target.campaignId ?? unit.id) : unit.id,
    campaignId: unit.level === 'campaign' ? loaded.target.campaignId : null,
    scaleAdsetId: loaded.target.scaleAdsetId,
    beforeCents: before,
    afterCents: option.afterCents,
    goalId: goal.id,
    cycleDate: loaded.target.cycleDate,
    requestId: null,
    snapshotAt: new Date().toISOString(),
  })
  if (!issued.card) return NextResponse.json({ error: issued.reason ?? '没有出确认卡，没有改预算。', wroteMeta: false }, { status: 409 })
  return NextResponse.json({
    ok: true, status: 'awaiting_confirmation', wroteMeta: false,
    runId: issued.card.runId, beforeCents: before, afterCents: option.afterCents, card: issued.card,
  }, { status: 202 })
}

async function submitReduce(clientId: string, unit: BudgetChangeUnit, targetCents: unknown, requestId: unknown): Promise<NextResponse> {
  const access = await requireStopLossAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return NextResponse.json({ error: 'request_id 必须是 UUID' }, { status: 400 })
  }
  const loaded = await loadBudgetChange(supabaseAdmin, clientId, unit)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const target = typeof targetCents === 'number' ? targetCents : Number.NaN
  const check = validateReduceTarget(loaded.plan, target)
  if (!check.ok || loaded.plan.currentCents === null || !loaded.target.campaignId) {
    return NextResponse.json({ error: check.ok ? '读不到这个组所属的系列' : check.reason }, { status: 409 })
  }
  // 跟老止损路由一样，再核一次这个系列属于客户登记的广告账户（内核降预算能力本身不查归属）
  const token = await getMetaTokenForClient(clientId)
  if (!token) return NextResponse.json({ error: '暂时连不上这个客户的 Meta 账户' }, { status: 424 })
  const ownership = await assertCampaignOwnedByClient(loaded.target.campaignId, clientId, token)
  if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: 403 })
  const goal = unit.level === 'adset' ? await activeGoalId(clientId) : null
  if (goal && 'error' in goal) return goal.error
  const timezone = await resolveAccountTimezone(unit.adAccountId)
  if (!timezone) return NextResponse.json({ error: '读不到广告账户时区', wroteMeta: false }, { status: 503 })
  const issued = await issueScorecardCard(clientId, access, unit, {
    source: 'scorecard_down',
    entityId: unit.id,
    campaignId: loaded.target.campaignId,
    scaleAdsetId: null,
    beforeCents: loaded.plan.currentCents,
    afterCents: target,
    goalId: goal && 'id' in goal ? goal.id : null,
    cycleDate: accountDayKey(timezone, new Date()),
    requestId,
    snapshotAt: new Date().toISOString(),
  })
  if (!issued.card) return NextResponse.json({ error: issued.reason ?? '没有出确认卡，没有改预算。', wroteMeta: false }, { status: 409 })
  return NextResponse.json({
    ok: false, status: 'awaiting_confirmation', wroteMeta: false,
    runId: issued.card.runId, beforeCents: loaded.plan.currentCents, afterCents: target, card: issued.card,
  }, { status: 202 })
}

async function issueScorecardCard(
  clientId: string,
  access: Extract<Awaited<ReturnType<typeof requireStopLossAccess>>, { ok: true }>,
  unit: BudgetChangeUnit,
  spec: {
    source: 'scorecard_up' | 'scorecard_down'
    entityId: string
    campaignId: string | null
    scaleAdsetId: string | null
    beforeCents: number
    afterCents: number
    goalId: string | null
    cycleDate: string
    requestId: string | null
    snapshotAt: string
  },
) {
  return issueMoneyBudget({
    kernel: createKernel(supabaseAdmin),
    sb: supabaseAdmin,
    clientId,
    clicker: clickerFromAccess(access, clientId),
    source: spec.source,
    level: unit.level,
    entityId: spec.entityId,
    adAccountId: unit.adAccountId,
    campaignId: spec.campaignId,
    scaleAdsetId: spec.scaleAdsetId,
    name: spec.entityId,
    beforeCents: spec.beforeCents,
    afterCents: spec.afterCents,
    snapshotAt: spec.snapshotAt,
    goalId: spec.goalId,
    cycleDate: spec.cycleDate,
    requestId: spec.requestId,
    readLive: () => loadMoneyBudgetLive(supabaseAdmin, clientId, {
      level: unit.level,
      entityId: spec.entityId,
      adAccountId: unit.adAccountId,
      name: spec.entityId,
      beforeCents: spec.beforeCents,
      afterCents: spec.afterCents,
    }),
  })
}
