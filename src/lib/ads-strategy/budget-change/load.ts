/**
 * 成绩单「调预算」预览的取数（第 3 刀 3b，设计稿 `docs/specs/2026-11-03-ads-knife3-spend-gate-and-budget-buttons-design.md` §3）。
 *
 * 只读：读最新成绩单（认这个组是不是这个客户的）、当场读 Meta（当前预算 + 最后修改时间）、
 * 读内核信封事实并用「PM 放量信封」判 +10% / +20%。纯计算交给 `plan.ts`。
 *
 * 🔴 判得过不等于会执行：加预算提交后仍挂起等 PM 本人批，内核批准时和碰 Meta 前还会各判一次。
 * 🔴 系列（CBO）只能在「系列下恰好一个在投广告组」时加——内核的加预算动作要求这样（`envelope-facts.ts`
 *    ads.scale_unit_budget 分支）；多个在投组时只能减、不能加，预览写明原因。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createCapabilities } from '@/lib/capabilities'
import { createAdsEnvelopeFactsResolver } from '@/lib/capabilities/ads/envelope-facts'
import { isWithinPmScaleEnvelope, type EnvelopeVerdict } from '@/lib/kernel/autonomy-envelope'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { findSingleDeliveringChild } from './cbo-single-child'
import { getBudgetEntityLive, type BudgetEntityLive } from '@/lib/meta/budget-entity-live'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import type { AdsScorecard } from '@/lib/ads-strategy/portfolio/scorecard'
import { planBudgetChange, scaledAfterCents, type BudgetChangePlan, type ScaleKind } from './plan'

export interface BudgetChangeUnit {
  readonly level: 'adset' | 'campaign'
  readonly id: string
  readonly adAccountId: string
}

export interface BudgetChangeTarget extends BudgetChangeUnit {
  /** 加预算时内核要的来源广告组（广告组本身，或 CBO 系列下唯一在投的那个）。不能加 = null */
  readonly scaleAdsetId: string | null
  /** 广告组所属系列 / 系列本身 */
  readonly campaignId: string | null
  readonly cycleDate: string
}

export type LoadBudgetChangeResult =
  | { readonly ok: true; readonly plan: BudgetChangePlan; readonly target: BudgetChangeTarget }
  | { readonly ok: false; readonly status: 403 | 409 | 424 | 500; readonly error: string }

const SCORECARD_MAX_AGE_MS = 36 * 60 * 60 * 1000
const fail = (status: 403 | 409 | 424 | 500, error: string): LoadBudgetChangeResult => ({ ok: false, status, error })
const bare = (accountId: string) => accountId.replace(/^act_/, '')

/** 这个组在不在这个客户最新一天的成绩单里（成绩单已排除共用账户和别家主页的组）。 */
async function findInLatestScorecard(
  sb: SupabaseClient, clientId: string, unit: BudgetChangeUnit,
): Promise<{ found: true; date: string } | { found: false; error: string; status: 409 | 500 }> {
  const { data, error } = await sb.from('ads_growth_states').select('date, updated_at, payload')
    .eq('client_id', clientId).order('date', { ascending: false }).limit(1).maybeSingle()
  if (error) return { found: false, status: 500, error: '暂时读不到最新成绩单' }
  const scorecard = (data?.payload as { scorecard?: AdsScorecard | { error: string } } | null)?.scorecard
  if (!data || !scorecard || 'error' in scorecard) return { found: false, status: 409, error: '最新成绩单还没出来，暂时不能调' }
  // 跟 O1 同一把尺子：成绩单超过 36 小时没更新就不认（旧日期会被当成这次调整的周期日期）
  const age = Date.now() - Date.parse(String((data as { updated_at?: unknown }).updated_at ?? ''))
  if (!Number.isFinite(age) || age < 0 || age > SCORECARD_MAX_AGE_MS) return { found: false, status: 409, error: '最新成绩单已经超过 36 小时没更新，等新一轮巡察后再调' }
  const hit = scorecard.units.some(u => u.level === unit.level && u.id === unit.id && u.adAccountId === unit.adAccountId)
  return hit ? { found: true, date: String(data.date) } : { found: false, status: 409, error: '这个组不在最新成绩单里（可能不是这个客户的，或这 7 天没花钱）' }
}

/** 结构上能不能加；能加时给出内核要的来源广告组。 */
async function resolveScaleSource(
  unit: BudgetChangeUnit, live: BudgetEntityLive, token: string,
): Promise<{ scaleAdsetId: string | null; campaignId: string | null; blocked: string | null }> {
  if (unit.level === 'adset') {
    const campaignId = live.campaign_id ?? null
    if (!live.daily_budget) return { scaleAdsetId: null, campaignId, blocked: '这个组的预算设在系列上，不能单独改这个组' }
    return { scaleAdsetId: unit.id, campaignId, blocked: null }
  }
  const child = await findSingleDeliveringChild(unit.id, unit.adAccountId, token)
  if (child.ok) return { scaleAdsetId: child.adsetId, campaignId: unit.id, blocked: null }
  const blocked = child.reason === 'not_single'
    ? `这个系列下有 ${child.deliveringCount ?? 0} 个在投广告组，系统目前只支持「系列下只有一个在投组」时加系列预算；要加请先在 Meta 后台处理`
    : `${child.detail}，先不让加`
  return { scaleAdsetId: null, campaignId: unit.id, blocked }
}

interface EnvelopeRead {
  readonly verdicts: Record<ScaleKind, EnvelopeVerdict | null>
  readonly unavailable: string | null
  readonly clientDailyCapCents: number | null
  readonly clientDailyTotalCents: number | null
}

/** 用内核同一个信封事实解析器 + PM 放量信封，判 +10% / +20%。 */
async function readEnvelope(
  sb: SupabaseClient, clientId: string, target: BudgetChangeTarget, currentCents: number,
): Promise<EnvelopeRead> {
  const empty: EnvelopeRead = { verdicts: { up10: null, up20: null }, unavailable: null, clientDailyCapCents: null, clientDailyTotalCents: null }
  const approval = ACTION_REGISTRY.get('ads.scale_unit_budget')?.outwardAuthorization?.approval
  if (!target.scaleAdsetId || approval?.mode !== 'bounded') return empty
  const resolve = createAdsEnvelopeFactsResolver({ sb, capabilities: createCapabilities(sb) })
  const verdicts: Record<ScaleKind, EnvelopeVerdict | null> = { up10: null, up20: null }
  let caps = { cap: null as number | null, total: null as number | null }
  for (const kind of ['up10', 'up20'] as const) {
    const afterCents = scaledAfterCents(currentCents, kind)
    const input: Record<string, unknown> = {
      cycle_date: target.cycleDate, ad_account_id: target.adAccountId, adset_id: target.scaleAdsetId,
      ...(target.level === 'campaign' && target.campaignId ? { campaign_id: target.campaignId } : {}),
      before_cents: currentCents, after_cents: afterCents,
    }
    const resolved = await resolve({ clientId, actionKey: 'ads.scale_unit_budget', input, at: 'authorize', runId: 'budget-change-preview' })
    if ('unavailable' in resolved) return { ...empty, unavailable: resolved.unavailable }
    verdicts[kind] = isWithinPmScaleEnvelope(resolved.request, resolved.facts, approval.envelope)
    caps = { cap: resolved.facts.clientDailyCapCents, total: resolved.facts.clientDailyTotalBeforeCents }
  }
  return { verdicts, unavailable: null, clientDailyCapCents: caps.cap, clientDailyTotalCents: caps.total }
}

/** 这个组最近一份设置快照里的币种（只用来显示金额）。读不到 = null。 */
async function readCurrency(sb: SupabaseClient, clientId: string, unit: BudgetChangeUnit): Promise<string | null> {
  const { data } = await sb.from('ad_entity_snapshots').select('currency')
    .eq('client_id', clientId).eq('level', unit.level).eq('entity_id', unit.id)
    .order('captured_at', { ascending: false }).limit(1).maybeSingle()
  const currency = (data as { currency: string | null } | null)?.currency
  return typeof currency === 'string' && currency.trim() ? currency : null
}

/** 读齐预览要的事实并算出预览。任何一步读不到都如实返回，不拿默认值顶上。 */
export async function loadBudgetChange(
  sb: SupabaseClient, clientId: string, unit: BudgetChangeUnit, now: Date = new Date(),
): Promise<LoadBudgetChangeResult> {
  if (!/^\d{1,32}$/.test(unit.id)) return fail(409, '组编号格式不对')
  const listed = await findInLatestScorecard(sb, clientId, unit)
  if (!listed.found) return fail(listed.status, listed.error)
  const token = await getMetaTokenForClient(clientId)
  if (!token) return fail(424, '暂时连不上这个客户的 Meta 账户')
  const live = await getBudgetEntityLive(unit.id, unit.level, token)
  if (!live) return fail(409, '当场读不到 Meta 上这个组的设置，先不让改')
  if (!live.account_id || bare(live.account_id) !== bare(unit.adAccountId)) return fail(403, 'Meta 上这个组不属于成绩单里的那个广告账户')

  const source = await resolveScaleSource(unit, live, token)
  const target: BudgetChangeTarget = { ...unit, scaleAdsetId: source.scaleAdsetId, campaignId: source.campaignId, cycleDate: listed.date }
  const currentCents = live.daily_budget ? Number(live.daily_budget) : Number.NaN
  const envelope = Number.isSafeInteger(currentCents) && currentCents > 0
    ? await readEnvelope(sb, clientId, target, currentCents)
    : { verdicts: { up10: null, up20: null }, unavailable: null, clientDailyCapCents: null, clientDailyTotalCents: null }
  const plan = planBudgetChange({
    currentCents: Number.isSafeInteger(currentCents) ? currentCents : null,
    currency: await readCurrency(sb, clientId, unit),
    metaUpdatedTime: live.updated_time ?? null,
    now,
    scaleBlockedReason: source.blocked,
    envelope: envelope.verdicts,
    envelopeUnavailable: envelope.unavailable,
    clientDailyCapCents: envelope.clientDailyCapCents,
    clientDailyTotalCents: envelope.clientDailyTotalCents,
  })
  return { ok: true, plan, target }
}
