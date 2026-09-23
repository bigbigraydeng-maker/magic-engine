/**
 * 广告账户时区 → 「今天 / 昨天是哪一天」的唯一口径。
 *
 * Meta 按**广告账户自己的时区**切天，而 Render 跑在 UTC。凡是要回答「昨天」的地方
 * 都必须走这里，不要各写各的 `new Date()`：2026-09-23 的事故就是取数窗口按 UTC 算
 * 「昨天」，新西兰账户整整一天的数据从没被请求过（见 `daily-insights.requestWindow`
 * 的注释）。取数修好之后，判定 / 日报那一侧如果还按 UTC 算「昨天」，就换成每天最新
 * 的一天被 `lte(insight_date, …)` 滤掉——数据白存一天才被看到。
 *
 * 平台通用：时区一律从账户快照读，任何客户 / 行业都不在这里硬编码。
 */

import { supabaseAdmin } from '@/lib/supabase'

/**
 * Which calendar day it is right now IN THE AD ACCOUNT'S OWN TIMEZONE.
 *
 * Unknown timezone falls back to UTC — identical to what the callers did before
 * they knew about timezones, so an account with no snapshot yet is no worse off.
 */
export function accountDayKey(timezone: string | null, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/**
 * 该账户时区下「昨天」——最后一个**已经跑完**的自然日，也就是 Meta 数据完整的最后一天。
 *
 * 日期字符串上做 UTC 日历加减：输入已经是本地化过的日键，中间不跨任何挂钟小时，没有 DST 边界。
 */
export function accountYesterday(timezone: string | null, now: Date): string {
  const today = new Date(`${accountDayKey(timezone, now)}T00:00:00Z`)
  today.setUTCDate(today.getUTCDate() - 1)
  return today.toISOString().slice(0, 10)
}

/**
 * The ad account's reporting timezone, as Meta reported it into the latest
 * account-level snapshot.
 *
 * Read from storage rather than the Graph API on purpose: the value changes
 * essentially never, the same daily cron's snapshot sync already captures it
 * for every account, and Meta's BUC quota is charged per call — spending one
 * on a constant, several times a day per account, buys nothing.
 *
 * Deliberately NOT scoped by client_id. The timezone is a property of the ad
 * account, not of whoever registered it, so a shared or secondary account
 * snapshotted under another client still resolves instead of silently
 * dropping back to UTC.
 *
 * Never throws and never propagates an error: a failed timezone read must
 * degrade to UTC, not take the day's data sync (or the day's verdict) down.
 */
export async function resolveAccountTimezone(adAccountId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('ad_entity_snapshots')
      .select('timezone_name')
      .eq('ad_account_id', adAccountId)
      .eq('level', 'account')
      .order('captured_at', { ascending: false })
      .limit(1)
    if (error) return null
    return (data as Array<{ timezone_name: string | null }> | null)?.[0]?.timezone_name ?? null
  } catch {
    return null
  }
}

/**
 * 这个客户今天该评估**哪一天** —— 取「客户名下每个广告账户各自时区的昨天」里**最早**的那一天。
 *
 * 为什么是最早（最保守）而不是最新：体检（`evaluateClientAdHealth`）和内部诊断都是
 * **按 client_id 聚合、不分账户**的，一个客户可以同时有 Pacific/Auckland 和
 * Australia/Brisbane 的账户（库里现在就是 6 + 1）。两地相差 2–3 小时，一天里有一段
 * 时间两边的「昨天」不是同一天。这时候：
 *   - 取最新 → 落后那个账户的那一天还没过完，半天的花费 / 转化会被当成一整天喂进
 *     相对基线和窗口合计里。花费凭空少一半，CTR 分母变形——在 PM 2026-09-24 授权的
 *     广告全自动收放回路上，这是会**误停在投广告**的方向。
 *   - 取最早 → 每个账户的这一天都已经跑完，数据完整；代价只是跨时区客户在那一小段
 *     时间窗里晚一天看到最新的数据。
 * 错一天的新鲜度，比错一次自动暂停便宜得多，所以取最早。
 *
 * 一个账户都没有（或全都读不到时区）→ 回落 UTC 的昨天，与修复前行为一致。
 */
export async function resolveClientEvaluationDate(
  adAccountIds: Array<string | null | undefined>,
  now: Date = new Date(),
): Promise<string> {
  const ids = Array.from(new Set(adAccountIds.filter((id): id is string => !!id)))
  if (ids.length === 0) return accountYesterday(null, now)

  const timezones = await Promise.all(ids.map(id => resolveAccountTimezone(id)))
  // ISO 日期串按字典序排就是按时间排。
  return timezones.map(tz => accountYesterday(tz, now)).sort()[0]
}
