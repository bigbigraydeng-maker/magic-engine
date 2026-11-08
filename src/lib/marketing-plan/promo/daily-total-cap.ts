/**
 * One client's daily total ad cap, stored on the promo plan:
 * `plan_data.promo.daily_total_cap_cents` (minor units).
 *
 * Budget raises and the kernel spend-cap check read only this number,
 * and only from the approved plan the approval-source lock already picked.
 * It is never a placeholder, and never the sum of campaign daily budgets.
 *
 * Older columns stay in the database. They are not a second runtime total:
 * - `ad_strategy_configs.daily_budget_cap_cents` is the old client total.
 *   Readers use the approved plan. The column may still be shown as a legacy hint.
 * - `client_meta_ad_accounts.daily_budget_cap_cents` is the per-account ceiling.
 *   Adding those ceilings up is not the client total.
 */

export function dailyTotalCapCents(planData: unknown): number | null {
  if (!planData || typeof planData !== 'object') return null
  const promo = (planData as { promo?: unknown }).promo
  if (!promo || typeof promo !== 'object' || Array.isArray(promo)) return null
  const raw = (promo as { daily_total_cap_cents?: unknown }).daily_total_cap_cents
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) return null
  return raw
}

export function dailyTotalCapSentence(planData: unknown): string {
  const cents = dailyTotalCapCents(planData)
  if (cents === null) return '还没在计划里写下每天的广告总上限。'
  const yuan = cents % 100 === 0 ? String(cents / 100) : String(cents / 100)
  return `每天的广告总上限是 ${yuan} 元。改这个数字要重新批准计划。`
}
