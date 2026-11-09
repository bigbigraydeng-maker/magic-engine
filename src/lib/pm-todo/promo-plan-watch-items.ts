/**
 * 今日待办里的「推广计划每日检查」栏。
 *
 * 推广计划每天新西兰 07:10 由 Inngest 函数 `promo-plan-daily-watch` 检查一遍（只读），
 * 回执写进 `cron_run_logs.summary`。这里只**读那份回执**翻成待办，不自己现算——
 * 只有一个真相源；每日函数挂了 / 没同步 / 跑完读不到计划，这里也会喊出来，不会静默。
 *
 * 两种待办：
 *   · promo_plan_watch        要 PM 拍板的（等批准 / 批准后被改 / 到期阶段检查没过 / 对账偏差 / 对账看不清）
 *   · promo_plan_watch_broken 检查自己没跑成（开发欠账，不占 PM 的清单；PM 那一栏会留一句「今天没查成」）
 *
 * 同一份计划的多条发现合成一条待办；同一件事连着出现，按 remind-cadence 降频
 * （前 3 天每天提醒，之后只在周日）——不然 PM 会被同一句话天天刷屏。
 *
 * 🔴 本文件一行写库都没有。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { shouldRemindToday, streakPhrase } from './remind-cadence'
import { PROMO_WATCH_JOB, type WatchReceipt, type WatchReceiptItem } from '@/lib/marketing-plan/promo/daily-watch-run'

const INFRA_CLIENT_ID = 'infra'
const INFRA_CLIENT_NAME = 'Magic Engine 后台'
const INNGEST_URL = 'https://app.inngest.com'

/** 回执超过这么久没更新，就当每日检查没在跑。 */
const STALE_MS = 36 * 60 * 60 * 1000
/** 停在 running 超过这么久就当卡死。 */
const RUNNING_STUCK_MS = 2 * 60 * 60 * 1000
/** 回看多久的运行记录（算「连着出现几天」要用）。 */
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000

interface RunRow {
  status: string | null
  started_at: string
  error_message: string | null
  summary: unknown
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function promoPlanHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/promo-plan`
}

function brokenItem(what: string, how: string, clientId = INFRA_CLIENT_ID, clientName = INFRA_CLIENT_NAME, href = ''): ManualItem {
  return { kind: 'promo_plan_watch_broken', client_id: clientId, client_name: clientName, what, how, href }
}

/** 运行时校验：summary 必须是带 status / plans / items 的回执。 */
export function isWatchReceiptLike(value: unknown): value is WatchReceipt {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.status !== 'string' || !Array.isArray(v.plans) || !Array.isArray(v.items)) return false
  for (const i of v.items) {
    if (typeof i !== 'object' || i === null) return false
    const e = i as Record<string, unknown>
    if (typeof e.client_id !== 'string' || typeof e.plan_id !== 'string') return false
    if (typeof e.what !== 'string' || typeof e.how !== 'string' || typeof e.code !== 'string') return false
  }
  return true
}

/** 这份计划的这件事，连着几天都在回执里（含今天这一轮）。回执按时间新→旧。 */
function streakOf(planId: string, code: string, receipts: WatchReceipt[], dayKeys: string[]): number {
  let streak = 0
  let prevDay: number | null = null
  for (let i = 0; i < receipts.length; i++) {
    const has = receipts[i].items.some(it => it.plan_id === planId && it.code === code)
    if (!has) break
    const day = Date.parse(`${dayKeys[i]}T00:00:00Z`) / 86_400_000
    // 同一天跑了两次不重复算；中间隔了一天以上就断
    if (prevDay !== null) {
      if (prevDay - day === 0) continue
      if (prevDay - day > 1) break
    }
    streak += 1
    prevDay = day
  }
  return streak
}

/** 把回执里的条目按计划合成待办：一份计划一条。 */
export function buildPromoPlanWatchItems(
  receipts: WatchReceipt[],
  dayKeys: string[],
  nameOf: (id: string) => string,
  now: Date,
): ManualItem[] {
  const latest = receipts[0]
  const out: ManualItem[] = []

  if (latest.status === 'read_failed') {
    out.push(brokenItem(
      `推广计划每日检查没跑成（读不到计划列表：${truncate(latest.error ?? '没留原因', 120)}）——今天没有报警不等于计划都正常。`,
      '这条不用你动手，是我们这边的欠账。',
      INFRA_CLIENT_ID, INFRA_CLIENT_NAME, INNGEST_URL,
    ))
    return out
  }

  for (const p of latest.plans) {
    if (p.error === null) continue
    out.push(brokenItem(
      `推广计划《${truncate(p.title, 60)}》的每日检查没跑成：${truncate(p.error, 120)}——今天没有报警不等于这份计划正常。`,
      '这条不用你动手，是我们这边的欠账；连续几天都这样，请找开发看。',
      p.client_id, nameOf(p.client_id), promoPlanHref(p.client_id),
    ))
  }
  if (latest.error !== null && latest.plans.every(p => p.error === null)) {
    // 只有「超过 50 份没检查完」这类整体提示
    out.push(brokenItem(
      `推广计划每日检查没查完：${truncate(latest.error, 120)}。`,
      '这条不用你动手，是我们这边的欠账。',
    ))
  }

  // 一份计划一条：多条发现合并；「连着几天」按其中最久的那件事算
  const byPlan = new Map<string, WatchReceiptItem[]>()
  for (const it of latest.items) {
    const list = byPlan.get(it.plan_id) ?? []
    list.push(it)
    byPlan.set(it.plan_id, list)
  }
  const daysSinceLatest = Math.max(0, Math.floor((now.getTime() - Date.parse(`${dayKeys[0]}T00:00:00Z`)) / 86_400_000))

  for (const [planId, listAll] of byPlan) {
    let list = listAll
    // 「读不到每日计划」是我们这边的欠账（文案本身写着「不用你动手」），走开发欠账，不进 PM 的清单
    const infra = list.filter(it => it.code === 'daily_plan_unreadable')
    for (const it of infra) {
      out.push(brokenItem(it.what, it.how, it.client_id, nameOf(it.client_id), promoPlanHref(it.client_id)))
    }
    list = list.filter(it => it.code !== 'daily_plan_unreadable')
    if (list.length === 0) continue
    const streak = Math.max(...list.map(it => streakOf(planId, it.code, receipts, dayKeys)))
    if (!shouldRemindToday(streak, daysSinceLatest, now)) continue
    const clientId = list[0].client_id
    const hows = [...new Set(list.map(it => it.how).filter(h => h !== ''))]
    const note = streak > 1 ? `（这件事${streakPhrase(streak)}还没处理）` : ''
    out.push({
      kind: 'promo_plan_watch',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `${list.map(it => it.what).join(' ')}${note}`,
      how: hows.join(' '),
      href: promoPlanHref(clientId),
    })
  }
  return out
}

/** 从最近几轮每日检查的回执生成待办。读失败 / 没跑 / 过期都要出一条，不能静默。 */
export async function pushPromoPlanWatchItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
  now: Date = new Date(),
): Promise<void> {
  let rows: RunRow[]
  try {
    const { data, error } = await supabase
      .from('cron_run_logs')
      .select('status, started_at, error_message, summary')
      .eq('job_name', PROMO_WATCH_JOB)
      .gte('started_at', new Date(now.getTime() - LOOKBACK_MS).toISOString())
      .order('started_at', { ascending: false })
      .limit(14)
    if (error) throw new Error(error.message)
    rows = (data ?? []) as RunRow[]
  } catch (err) {
    items.push(brokenItem(
      `查不到「推广计划每日检查」最近跑得怎么样（${truncate(err instanceof Error ? err.message : String(err), 120)}），所以现在没法确认推广计划有没有问题。`,
      '这条不用你动手，是我们这边的欠账。',
    ))
    return
  }

  if (rows.length === 0) {
    items.push(brokenItem(
      '「推广计划每日检查」两周内没有任何运行记录——没人在每天查推广计划。',
      '多半是定时函数还没同步到 Inngest 后台：这是我们这边的欠账，会有人去同步；你不用动手。',
      INFRA_CLIENT_ID, INFRA_CLIENT_NAME, INNGEST_URL,
    ))
    return
  }

  const latest = rows[0]
  const age = now.getTime() - Date.parse(latest.started_at)

  if (latest.status === 'running') {
    if (age <= RUNNING_STUCK_MS) return
    items.push(brokenItem('「推广计划每日检查」最近一轮开了头却超过 2 小时没收尾——多半是中途被中断了。', '这条不用你动手，是我们这边的欠账。'))
    return
  }
  if (latest.status === 'failed' || latest.error_message) {
    items.push(brokenItem(
      `「推广计划每日检查」最近一轮没跑成：${truncate(latest.error_message ?? '没留原因', 160)}。`,
      '这条不用你动手，是我们这边的欠账。',
    ))
    return
  }
  if (Number.isFinite(age) && age > STALE_MS) {
    items.push(brokenItem(
      '「推广计划每日检查」超过一天没跑了——推广计划现在没人在每天查。',
      '这条不用你动手，是我们这边的欠账。',
      INFRA_CLIENT_ID, INFRA_CLIENT_NAME, INNGEST_URL,
    ))
    return
  }

  // 只取回执读得懂的、已经收尾的几轮（新→旧）；最新一轮读不懂就喊出来
  if (!isWatchReceiptLike(latest.summary)) {
    items.push(brokenItem('「推广计划每日检查」最近一轮的回执读不出来（格式不对）——这一栏空着不等于没事。', '这条不用你动手，是我们这边的欠账。'))
    return
  }
  const usable = rows.filter(r => r.status !== 'running' && isWatchReceiptLike(r.summary))
  const receipts = usable.map(r => r.summary as WatchReceipt)
  const dayKeys = usable.map(r => r.started_at.slice(0, 10))
  items.push(...buildPromoPlanWatchItems(receipts, dayKeys, nameOf, now))
}
