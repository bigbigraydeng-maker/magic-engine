/**
 * 今日待办里的「开投前追踪检查」栏。
 *
 * 开投前追踪检查由 Inngest 函数 `ads-tracking-preflight` 每天跑一遍（只读），
 * 回执写进 `cron_run_logs.summary`。这里只**读那份回执**翻成待办，不自己现算——
 * 只有一个真相源；每日函数挂了 / 没同步 / 回执读不懂，这里也会喊出来，不会静默。
 *
 * 两种待办：
 *   · ads_tracking_preflight_fix    回执里的红灯（或硬门灰）原样下发，告诉开发怎么修
 *   · ads_tracking_preflight_broken 检查自己没跑成（开发欠账，不占 PM 的清单；PM 那一栏会留一句「今天没查成」）
 *
 * 🔴 本文件一行写库都没有。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { listTrackingClientIds } from '@/lib/ads-tracking-preflight/client-config'
import {
  TRACKING_PREFLIGHT_JOB,
  TRACKING_RECEIPT_STALE_HOURS,
  isTrackingRunReceiptLike,
  pickLatestClientReceipt,
  receiptAgeHours,
} from '@/lib/ads-tracking-preflight/receipt'

const INFRA_CLIENT_ID = 'infra'
const INFRA_CLIENT_NAME = 'Magic Engine 后台'
const INNGEST_URL = 'https://app.inngest.com'

/** 停在 running 超过这么久就当卡死。 */
const RUNNING_STUCK_MS = 2 * 60 * 60 * 1000
/** 回看多久的运行记录。 */
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
  return { kind: 'ads_tracking_preflight_broken', client_id: clientId, client_name: clientName, what, how, href }
}

const INFRA_HOW = '这条不用你动手，是我们这边的欠账。'

/** 读最近几轮运行记录；读失败就抛错，由调用方翻成待办。 */
async function loadRows(supabase: SupabaseClient, now: Date): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('status, started_at, error_message, summary')
    .eq('job_name', TRACKING_PREFLIGHT_JOB)
    .gte('started_at', new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .order('started_at', { ascending: false })
    .limit(14)
  if (error) throw new Error(error.message)
  return (data ?? []) as RunRow[]
}

/**
 * 看最近一轮本身有没有问题（卡死 / 失败 / 过期 / 回执读不懂 / 整轮自报有问题）。
 * 返回 true = 已经出了待办、不该再往下翻客户回执。
 */
function checkLatestRun(latest: RunRow, now: Date, items: ManualItem[]): boolean {
  const age = now.getTime() - Date.parse(latest.started_at)

  if (latest.status === 'running') {
    if (age <= RUNNING_STUCK_MS) return true
    items.push(brokenItem('「开投前追踪检查」最近一轮开了头却超过 2 小时没收尾——多半是中途被中断了。', INFRA_HOW))
    return true
  }
  if (latest.status === 'failed' || latest.error_message) {
    items.push(brokenItem(
      `「开投前追踪检查」最近一轮没跑成：${truncate(latest.error_message ?? '没留原因', 160)}。`,
      INFRA_HOW,
    ))
    return true
  }
  if (Number.isFinite(age) && age > TRACKING_RECEIPT_STALE_HOURS * 3_600_000) {
    items.push(brokenItem(
      '「开投前追踪检查」超过一天没跑了——追踪现在没人在每天查。',
      INFRA_HOW,
      INFRA_CLIENT_ID, INFRA_CLIENT_NAME, INNGEST_URL,
    ))
    return true
  }
  if (!isTrackingRunReceiptLike(latest.summary)) {
    items.push(brokenItem('「开投前追踪检查」最近一轮的回执读不出来（格式不对）——这一栏空着不等于没事。', INFRA_HOW))
    return true
  }
  return false
}

/**
 * 整轮回执自己说有问题（比如叫醒事件里的客户没配置）：出一条欠账，但不挡住后面的客户回执。
 * 只管「这一轮一个客户都没查成」的情况（事件内容有问题 / 没有任何客户配置）。
 * 有客户查了、只是部分读不到（比如 GA4 没连）：灰灯在推广计划页上、硬门读不到的红灯待办已经下发，
 * 这里再出一条会天天重复，所以不出。
 */
function reportRunSelfError(latest: RunRow, items: ManualItem[]): void {
  if (!isTrackingRunReceiptLike(latest.summary)) return
  const { status, error, clients } = latest.summary
  if (status === 'ok' || clients.length > 0) return
  if (typeof error !== 'string' || error.length === 0) return
  items.push(brokenItem(
    `「开投前追踪检查」这一轮自己报了问题：${truncate(error, 160)}。`,
    INFRA_HOW,
  ))
}

/** 一个客户：没回执 / 回执过期 → 欠账；否则把回执里的红灯原样下发。 */
function pushClientItems(
  rows: RunRow[],
  clientId: string,
  nameOf: (id: string) => string,
  now: Date,
  items: ManualItem[],
): void {
  const picked = pickLatestClientReceipt(rows, clientId)
  const clientName = nameOf(clientId)
  const href = promoPlanHref(clientId)

  if (picked === null) {
    items.push(brokenItem(
      `「开投前追踪检查」最近几轮里还没有 ${clientName} 的回执——这个客户的追踪现在没人在查。`,
      INFRA_HOW,
      clientId, clientName, href,
    ))
    return
  }

  const age = receiptAgeHours(picked.receipt.checked_at, now)
  if (age === null || age > TRACKING_RECEIPT_STALE_HOURS) {
    const ageText = age === null ? '未知' : String(Math.round(age))
    items.push(brokenItem(
      `「开投前追踪检查」里 ${clientName} 的回执已 ${ageText} 小时没更新——追踪现在没人在查。`,
      INFRA_HOW,
      clientId, clientName, href,
    ))
    return
  }

  for (const item of picked.receipt.items) {
    items.push({
      kind: 'ads_tracking_preflight_fix',
      client_id: item.client_id,
      client_name: nameOf(item.client_id),
      what: item.what,
      how: item.how,
      href: item.href,
    })
  }
}

/** 从最近几轮开投前追踪检查的回执生成待办。读失败 / 没跑 / 过期都要出一条，不能静默。 */
export async function pushAdsTrackingPreflightItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
  now: Date = new Date(),
): Promise<void> {
  const clientIds = listTrackingClientIds()
  if (clientIds.length === 0) return

  let rows: RunRow[]
  try {
    rows = await loadRows(supabase, now)
  } catch (err) {
    items.push(brokenItem(
      `查不到「开投前追踪检查」最近跑得怎么样（${truncate(err instanceof Error ? err.message : String(err), 120)}），所以现在没法确认追踪有没有问题。`,
      INFRA_HOW,
    ))
    return
  }

  if (rows.length === 0) {
    items.push(brokenItem(
      '「开投前追踪检查」两周内没有任何运行记录——没人在每天查追踪。',
      '多半是定时函数还没同步到 Inngest 后台：这是我们这边的欠账，会有人去同步；你不用动手。',
      INFRA_CLIENT_ID, INFRA_CLIENT_NAME, INNGEST_URL,
    ))
    return
  }

  const latest = rows[0]
  if (checkLatestRun(latest, now, items)) return

  reportRunSelfError(latest, items)

  const usable = rows.filter(r => r.status !== 'running')
  for (const clientId of clientIds) {
    pushClientItems(usable, clientId, nameOf, now, items)
  }
}
