/**
 * Ad-set level reads/writes — the half of budget control `client.ts` never had.
 *
 * Why this exists: a Meta campaign holds its daily budget in ONE of two places.
 * CBO campaigns carry it on the campaign; ABO campaigns carry it on each ad set
 * and the campaign reports no budget at all. `setCampaignDailyBudget` only
 * handles the first, so the execute route used to answer the second case with
 * "adjust the budget directly in Meta Ads Manager" — handing the work back to
 * the operator, which this project forbids. These helpers let us cut an ABO
 * campaign's spend ourselves.
 *
 * Kept out of `client.ts` deliberately: that file is at the 800-line ceiling.
 */

import { GRAPH_BASE } from './graph-base'

export interface AdSetSummary {
  id: string
  name: string
  /**
   * 🔴 **这一列不能单独用来判「在不在投」**（手册 §二十九 防复发 + PR #2110 生产实证）。
   *
   *    `status` 是这个广告组**自己**的开关。真实投放状态还要看它上面那一层：
   *    **「系列 ACTIVE + 组 PAUSED」是最常见的「假在投」** —— 2026-09-27 实测 CTS
   *    二号账户 3 条系列显示 ACTIVE，旗下广告组**全是 PAUSED**（每天 12/12/34 纽币），
   *    广告全是 `ADSET_PAUSED`；直接问 Meta 拿逐日花费确认 9/23 起一分钱没花。
   *    只看系列层就会把这 3 条当成在投的。
   *
   *    判「在不在投」一律用下面的 `effective_status` 配
   *    `DELIVERING_STATUSES`（`diagnostics/context.ts`），或者以有没有花费为准。
   */
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED'
  /**
   * Meta 算出来的**实际**投放状态（已把上层暂停、审核、账单问题都算进去）。
   * 判「在不在投」用这一列 + `DELIVERING_STATUSES`，不要用上面那个 `status`。
   * 可能缺（老代码请求时没要这个字段）—— 缺就当**读不到**，不要当「没在投」。
   */
  effective_status?: string
  /** Minor units (cents) as a string, exactly as Meta returns it. Absent on CBO. */
  daily_budget?: string
  /** 裸数字(无 "act_" 前缀)——归属校验用,见 winner-reel-sync/engine.ts。 */
  account_id?: string
}

/**
 * List the ad sets under a campaign, newest first as Meta returns them.
 *
 * Returns null on transport/API failure so callers can tell "no ad sets" (an
 * empty array — a real, actionable answer) apart from "we could not look"
 * (null — must not be reported to the user as an empty campaign).
 */
export async function listAdSetsInCampaign(
  campaignId: string,
  accessToken: string,
): Promise<AdSetSummary[] | null> {
  const params = new URLSearchParams({
    fields: 'id,name,status,effective_status,daily_budget',
    limit: '50',
    access_token: accessToken,
  })
  const url = `${GRAPH_BASE}/${campaignId}/adsets?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.error('[meta/adsets] listAdSetsInCampaign fetch error:', err)
    return null
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/adsets] listAdSetsInCampaign HTTP ${res.status}:`, body.slice(0, 300))
    return null
  }

  const json = await res.json() as { data?: AdSetSummary[] }
  return json.data ?? []
}

/** Update one ad set's daily budget. Cents. Returns true only on confirmed success. */
export async function setAdSetDailyBudget(
  adSetId: string,
  accessToken: string,
  dailyBudgetCents: number,
): Promise<boolean> {
  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${adSetId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        daily_budget: String(Math.round(dailyBudgetCents)),
        access_token: accessToken,
      }).toString(),
    })
  } catch (err) {
    console.error('[meta/adsets] setAdSetDailyBudget fetch error:', err)
    return false
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/adsets] setAdSetDailyBudget HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  const json = await res.json() as { success?: boolean }
  return json.success === true
}

/** Read one ad set's status back — used to verify Meta's silent force-pause. */
export async function getAdSetStatus(
  adSetId: string,
  accessToken: string,
): Promise<AdSetSummary | null> {
  const params = new URLSearchParams({
    fields: 'id,name,status,effective_status,daily_budget,account_id',
    access_token: accessToken,
  })

  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${adSetId}?${params.toString()}`)
  } catch (err) {
    console.error('[meta/adsets] getAdSetStatus fetch error:', err)
    return null
  }
  if (!res.ok) return null

  return res.json() as Promise<AdSetSummary>
}

/** Set one ad set ACTIVE/PAUSED — the other half of the force-pause guard. */
export async function setAdSetStatus(
  adSetId: string,
  accessToken: string,
  status: 'ACTIVE' | 'PAUSED',
): Promise<boolean> {
  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${adSetId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status, access_token: accessToken }).toString(),
    })
  } catch (err) {
    console.error('[meta/adsets] setAdSetStatus fetch error:', err)
    return false
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/adsets] setAdSetStatus HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  const json = await res.json() as { success?: boolean }
  return json.success === true
}
