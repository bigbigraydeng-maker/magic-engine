/**
 * Stop-loss: the one action on the ads-health page that costs less money the
 * moment it is pressed.
 *
 * Why this exists (2026-07-25, PM): the page's only button was "补新素材", which
 * can only recycle organic posts the client already published. When there is
 * nothing to recycle it answered "系统明天会再自动扫" — a button whose sole
 * guaranteed effect was greying itself out. PM's verdict: "这不叫解决问题,没有
 * 闭环". The real question behind a 🔴 card is not "where is more creative" but
 * "is my money still burning" — and the ability to stop it (pause / cut budget)
 * already existed, just wired to nothing.
 *
 * Two guarantees this module keeps:
 *  1. It never hands the work back. A Meta campaign holds its budget either on
 *     the campaign (CBO) or on each ad set (ABO). Both are handled here; we do
 *     not tell the operator to go open Ads Manager.
 *  2. It never silently stops delivery. Changing a daily budget makes Meta
 *     force-pause the entity, so every cut re-reads status and reactivates
 *     anything that WAS active — and reports honestly when it could not.
 */

import type { CampaignDetails } from '@/lib/meta/client'
import type { AdSetSummary } from '@/lib/meta/adsets'

/** Auto-executable cut, matching the ±20% band in lib/meta/guardrails. */
export const STOP_LOSS_CUT_RATIO = 0.2

/**
 * Below this, a 20% cut is pointless and risks Meta rejecting the write for
 * being under the objective's minimum daily budget. Pausing is the honest
 * action instead. Deliberately conservative — Meta's true floor varies by
 * objective and currency, and a rejected write would read as a broken button.
 */
export const MIN_VIABLE_DAILY_CENTS = 200

export interface BudgetTarget {
  id: string
  name: string
  currentCents: number
  /** Only ACTIVE entities are cut; a paused one must never be reactivated. */
  wasActive: boolean
}

export type BudgetLocation =
  | { kind: 'campaign'; targets: BudgetTarget[] }
  | { kind: 'adsets'; targets: BudgetTarget[] }
  /** Lifetime-budget or unreadable — cutting is not available, pausing still is. */
  | { kind: 'none'; reason: 'lifetime_budget' | 'no_daily_budget' }

/**
 * Decide where this campaign's daily budget actually lives.
 *
 * `adSets` may be null when the lookup failed — that is NOT the same as a
 * campaign with no ad sets, so it resolves to 'none' rather than claiming there
 * is nothing to cut.
 */
export function resolveBudgetLocation(
  campaign: CampaignDetails,
  adSets: AdSetSummary[] | null,
): BudgetLocation {
  const campaignCents = parseCents(campaign.daily_budget)
  if (campaignCents > 0) {
    return {
      kind: 'campaign',
      targets: [{
        id: campaign.id,
        name: campaign.name,
        currentCents: campaignCents,
        wasActive: campaign.status === 'ACTIVE',
      }],
    }
  }

  // ABO: budget sits on the ad sets. Only ACTIVE ones are worth cutting —
  // trimming a paused ad set changes no spend and would risk reactivating
  // something a human deliberately switched off.
  const active = (adSets ?? [])
    .filter(a => a.status === 'ACTIVE' && parseCents(a.daily_budget) > 0)
    .map(a => ({
      id: a.id,
      name: a.name,
      currentCents: parseCents(a.daily_budget),
      wasActive: true,
    }))

  if (active.length > 0) return { kind: 'adsets', targets: active }

  return {
    kind: 'none',
    reason: parseCents(campaign.lifetime_budget) > 0 ? 'lifetime_budget' : 'no_daily_budget',
  }
}

export interface CutPlan {
  /** null when this entity is too small to cut meaningfully. */
  newCents: number | null
  reason?: 'below_minimum'
}

/**
 * Plan one entity's cut. Rounded to whole cents and floored at the viability
 * threshold, so we either make a real change or say we cannot.
 */
export function planCut(currentCents: number, ratio = STOP_LOSS_CUT_RATIO): CutPlan {
  const newCents = Math.round(currentCents * (1 - ratio))
  if (newCents < MIN_VIABLE_DAILY_CENTS) return { newCents: null, reason: 'below_minimum' }
  return { newCents }
}

/** Total daily spend today, and what it becomes after the cut. Dollars. */
export function summariseCut(location: BudgetLocation): {
  currentDaily: number
  plannedDaily: number | null
  cuttable: boolean
} {
  if (location.kind === 'none') return { currentDaily: 0, plannedDaily: null, cuttable: false }

  const currentCents = location.targets.reduce((s, t) => s + t.currentCents, 0)
  const plans = location.targets.map(t => planCut(t.currentCents))
  // All-or-nothing: a partial cut across ad sets would leave the campaign in a
  // state nobody asked for and is hard to explain or undo.
  if (plans.some(p => p.newCents === null)) {
    return { currentDaily: currentCents / 100, plannedDaily: null, cuttable: false }
  }

  const plannedCents = plans.reduce((s, p) => s + (p.newCents ?? 0), 0)
  return {
    currentDaily: currentCents / 100,
    plannedDaily: plannedCents / 100,
    cuttable: true,
  }
}

function parseCents(v: string | undefined): number {
  if (!v) return 0
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// ── Execution ────────────────────────────────────────────────────────────────

export interface TouchedEntity {
  id: string
  name: string
  ok: boolean
  /** Set when the force-pause guard could not certify delivery resumed. */
  warning?: string
}

export interface StopLossOutcome {
  action: 'cut' | 'pause'
  ok: boolean
  where: BudgetLocation['kind']
  touched: TouchedEntity[]
  currentDaily: number
  newDaily: number | null
}

export interface StopLossDeps {
  getCampaign: (id: string) => Promise<CampaignDetails | null>
  setCampaignStatus: (id: string, status: 'ACTIVE' | 'PAUSED') => Promise<boolean>
  setCampaignBudget: (id: string, cents: number) => Promise<boolean>
  listAdSets: (campaignId: string) => Promise<AdSetSummary[] | null>
  setAdSetBudget: (id: string, cents: number) => Promise<boolean>
  getAdSet: (id: string) => Promise<AdSetSummary | null>
  setAdSetStatus: (id: string, status: 'ACTIVE' | 'PAUSED') => Promise<boolean>
}

/**
 * Pause the whole campaign. Independent of where the budget lives, which is
 * why this is always offered even when a cut is not possible.
 */
async function doPause(
  campaign: CampaignDetails,
  deps: StopLossDeps,
): Promise<StopLossOutcome> {
  const ok = await deps.setCampaignStatus(campaign.id, 'PAUSED')
  return {
    action: 'pause',
    ok,
    where: 'campaign',
    touched: [{ id: campaign.id, name: campaign.name, ok }],
    currentDaily: 0,
    newDaily: 0,
  }
}

/**
 * Apply one entity's cut and hold the delivery promise: Meta force-pauses an
 * entity whose daily_budget was just written, so re-read and reactivate when it
 * was live before. A guard that fails silently is worse than none — an
 * un-certified entity carries a warning rather than being reported as fine.
 */
async function cutOne(
  t: BudgetTarget,
  newCents: number,
  kind: 'campaign' | 'adsets',
  deps: StopLossDeps,
): Promise<TouchedEntity> {
  const wrote = kind === 'campaign'
    ? await deps.setCampaignBudget(t.id, newCents)
    : await deps.setAdSetBudget(t.id, newCents)

  if (!wrote) return { id: t.id, name: t.name, ok: false }
  if (!t.wasActive) return { id: t.id, name: t.name, ok: true }

  const after = kind === 'campaign' ? await deps.getCampaign(t.id) : await deps.getAdSet(t.id)
  if (!after) {
    return {
      id: t.id, name: t.name, ok: true,
      warning: '预算已降,但没能确认广告还在投 — 请到 Meta 后台看一眼它没有被停。',
    }
  }
  if (after.status === 'ACTIVE') return { id: t.id, name: t.name, ok: true }

  const back = kind === 'campaign'
    ? await deps.setCampaignStatus(t.id, 'ACTIVE')
    : await deps.setAdSetStatus(t.id, 'ACTIVE')

  return back
    ? { id: t.id, name: t.name, ok: true }
    : {
        id: t.id, name: t.name, ok: true,
        warning: '预算已降,但广告被平台自动停了且没能自动开回来 — 现在是停的,需要到 Meta 后台手动开启。',
      }
}

/**
 * Run the chosen stop-loss action. Returns null when the campaign cannot be
 * read at all (caller turns that into a 502) and a `notCuttable` outcome when a
 * cut is impossible — never an instruction for the operator to go do it by hand.
 */
export async function executeStopLoss(
  campaignId: string,
  action: 'cut' | 'pause',
  deps: StopLossDeps,
): Promise<StopLossOutcome | { notCuttable: true; location: BudgetLocation; currentDaily: number } | null> {
  const campaign = await deps.getCampaign(campaignId)
  if (!campaign) return null

  if (action === 'pause') return doPause(campaign, deps)

  const needsAdSets = parseCents(campaign.daily_budget) === 0
  const location = resolveBudgetLocation(
    campaign,
    needsAdSets ? await deps.listAdSets(campaignId) : null,
  )
  const summary = summariseCut(location)

  if (location.kind === 'none' || !summary.cuttable) {
    return { notCuttable: true, location, currentDaily: summary.currentDaily }
  }

  const touched: TouchedEntity[] = []
  for (const t of location.targets) {
    const plan = planCut(t.currentCents)
    if (plan.newCents === null) continue   // unreachable: summary.cuttable gates it
    touched.push(await cutOne(t, plan.newCents, location.kind, deps))
  }

  return {
    action: 'cut',
    ok: touched.every(x => x.ok),
    where: location.kind,
    touched,
    currentDaily: summary.currentDaily,
    newDaily: summary.plannedDaily,
  }
}
