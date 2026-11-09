/**
 * 当场从 Meta 读一个广告组或广告系列的预算与最后修改时间（第 3 刀 3b 调预算预览用）。
 *
 * 为什么不读设置快照：快照 6 小时一次，且 ME 自己动手前会先记一份，人在 Ads Manager
 * 刚改过的那一下会被吞掉（设计稿 F12）。B-04「72 小时内只改一次，人改的也算」只能当场读 Meta。
 * 读不到返回 null —— 调用方按「读不到」处理，不当成「没改过」。
 */
import { GRAPH_BASE } from './graph-base'

export interface BudgetEntityLive {
  readonly id: string
  /** 分，Meta 原样返回的字符串。CBO 下的广告组没有这一项 */
  readonly daily_budget?: string
  readonly updated_time?: string
  readonly effective_status?: string
  /** 裸数字，无 act_ 前缀 */
  readonly account_id?: string
  /** 只有广告组有：所属广告系列 */
  readonly campaign_id?: string
}

export async function getBudgetEntityLive(
  entityId: string,
  level: 'adset' | 'campaign',
  accessToken: string,
): Promise<BudgetEntityLive | null> {
  if (!/^\d{1,32}$/.test(entityId)) return null
  const fields = level === 'adset'
    ? 'id,daily_budget,updated_time,effective_status,account_id,campaign_id'
    : 'id,daily_budget,updated_time,effective_status,account_id'
  const params = new URLSearchParams({ fields, access_token: accessToken })
  try {
    const res = await fetch(`${GRAPH_BASE}/${entityId}?${params.toString()}`)
    if (!res.ok) return null
    const json = await res.json() as BudgetEntityLive
    return typeof json?.id === 'string' && json.id === entityId ? json : null
  } catch (err) {
    console.error('[meta/budget-entity-live] fetch error:', err)
    return null
  }
}
