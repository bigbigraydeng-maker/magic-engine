/**
 * 广告组级**对外写** —— 真正会改客户在投广告、会动客户钱的两个调用。
 *
 * 为什么从 `adsets.ts` 拆出来（WP3.1b，2026-09-27）：
 *
 *   架构边界闸（`kernel/boundaries.ts` 的 `PROVIDER_WRITE_MODULES`）是**模块级**的：
 *   一个模块上了那张清单，`src/lib/capabilities/**` 之外谁都不许 import 它。
 *   `adsets.ts` 原本读写混在一起 —— 把它整个挂上闸，会连「只读一下广告组列表」
 *   这种完全无害的 import 一起挡掉；不挂，这道本该覆盖对外写的闸就根本没盖到
 *   Meta 广告写入面（2026-09-27 实测：止损路由直接 import 这些写函数，
 *   从来没撞上任何规则 —— 不是被豁免，是闸没覆盖）。
 *
 *   所以只把**写**的那一半搬出来单独挂闸，读的那一半留在 `adsets.ts`。
 *
 * 🔴 **不要在 `adsets.ts` 里 re-export 这两个函数** —— 那等于给闸开一条绕路。
 * 🔴 这个模块只能被 `src/lib/capabilities/**` import。要改客户广告组的预算或状态，
 *    正确做法是提交一个 `action_run`（`ads.cut_unit_budget` / `ads.pause_unit`）。
 */

import { GRAPH_BASE } from './graph-base'

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
    console.error('[meta/adset-writes] setAdSetDailyBudget fetch error:', err)
    return false
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/adset-writes] setAdSetDailyBudget HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  const json = await res.json() as { success?: boolean }
  return json.success === true
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
    console.error('[meta/adset-writes] setAdSetStatus fetch error:', err)
    return false
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/adset-writes] setAdSetStatus HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }

  const json = await res.json() as { success?: boolean }
  return json.success === true
}
