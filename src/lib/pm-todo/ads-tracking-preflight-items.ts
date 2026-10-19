/**
 * 今日待办里的「开投前追踪检查」栏。
 *
 * 开投前追踪检查由 Inngest 函数 `ads-tracking-preflight` 每天跑一遍（只读），
 * 回执写进 `cron_run_logs.summary`。这里只**读那份回执**翻成待办，不自己现算——
 * 只有一个真相源；每日函数挂了 / 没同步 / 回执读不懂，这里也会喊出来，不会静默。
 *
 * 两种待办：
 *   · ads_tracking_preflight_fix    回执里的红灯（或硬门灰）原样下发，告诉开发怎么修；
 *                                   开投后读回的红灯 / 黄灯（样本不足等）、以及「没读到」的灰灯（令牌失效 / 接口出错 /
 *                                   范围被拒）也在这里下发——它没有看板位置，只落日志就是死在日志里；
 *                                   预计开投日过了 24 小时盯盘还是找不到本次系列，也在这里喊一声
 *   · ads_tracking_preflight_broken 检查自己没跑成（开发欠账，不占 PM 的清单；PM 那一栏会留一句「今天没查成」）
 *
 * 🔴 本文件一行写库都没有。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { getTrackingClientConfig, listTrackingClientIds } from '@/lib/ads-tracking-preflight/client-config'
import { LAUNCH_WATCH_JOB, isWatchActive, seriesWatchStatusFromRows } from '@/lib/ads-tracking-preflight/launch-watch'
import { dateInTimezone } from '@/lib/ads-tracking-preflight/post-launch'
import {
  TRACKING_PREFLIGHT_JOB,
  TRACKING_RECEIPT_STALE_HOURS,
  isTrackingRunReceiptLike,
  pickLatestClientReceipt,
  pickLatestPostLaunchReceipt,
  pickNewestPostLaunchReceipt,
  receiptAgeHours,
} from '@/lib/ads-tracking-preflight/receipt'
import type { TrackingClientConfig, TrackingClientReceipt, TrackingReceiptItem } from '@/lib/ads-tracking-preflight/types'

const INFRA_CLIENT_ID = 'infra'
const INFRA_CLIENT_NAME = 'Magic Engine 后台'
const INNGEST_URL = 'https://app.inngest.com'

/** 停在 running 超过这么久就当卡死。 */
const RUNNING_STUCK_MS = 2 * 60 * 60 * 1000
/** 回看多久的运行记录。 */
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000
/** 开投后读回的待办挂多久：读回是一次性的，超过这么久（3 天）就不再挂，免得开投那一次的黄灯永远在。 */
const POST_LAUNCH_ITEM_WINDOW_HOURS = 72
/** 盯盘记录回看多少次（每小时一次，约 40 小时）。 */
const WATCH_LOOKBACK_ROWS = 40
/** 不到这么多次盯盘（约一天的量）不喊「找不到系列」，免得刚部署就喊。 */
const SERIES_ALARM_MIN_TICKS = 20
/** 最新一次盯盘超过这么久（3 小时）= 盯盘函数自己没在跑，不在这里把它说成「系列找不到」。 */
const SERIES_ALARM_MAX_TICK_AGE_MS = 3 * 60 * 60 * 1000

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

interface RunVerdict {
  /** 最近一轮本身出了问题、已经出了一条欠账（客户级的「没回执 / 回执过期」就不再重复叠一条） */
  brokeRun: boolean
  /** 整份别往下翻了：最近一次运行就已经超过一天，下面的客户回执只会更旧 */
  stop: boolean
}

/**
 * 看最近一轮本身有没有问题（卡死 / 失败 / 过期 / 回执读不懂）。
 *
 * 🔴 最近一轮不分种类（每天的体检、开投后读回、手动叫醒都写在同一个任务名下），它出了问题只出自己的一条欠账，
 *    不得把客户「更早的、还新鲜的」开投前红灯整份跳过——只有「最近一次运行就已经超过一天」才整份不翻。
 */
function checkLatestRun(latest: RunRow, now: Date, items: ManualItem[]): RunVerdict {
  const age = now.getTime() - Date.parse(latest.started_at)

  if (latest.status === 'running') {
    if (age <= RUNNING_STUCK_MS) return { brokeRun: false, stop: false }
    items.push(brokenItem('「开投前追踪检查」最近一轮开了头却超过 2 小时没收尾——多半是中途被中断了。', INFRA_HOW))
    return { brokeRun: true, stop: false }
  }
  if (latest.status === 'failed' || latest.error_message) {
    items.push(brokenItem(
      `「开投前追踪检查」最近一轮没跑成：${truncate(latest.error_message ?? '没留原因', 160)}。`,
      INFRA_HOW,
    ))
    return { brokeRun: true, stop: false }
  }
  if (Number.isFinite(age) && age > TRACKING_RECEIPT_STALE_HOURS * 3_600_000) {
    items.push(brokenItem(
      '「开投前追踪检查」超过一天没跑了——追踪现在没人在每天查。',
      INFRA_HOW,
      INFRA_CLIENT_ID, INFRA_CLIENT_NAME, INNGEST_URL,
    ))
    return { brokeRun: true, stop: true }
  }
  if (!isTrackingRunReceiptLike(latest.summary)) {
    items.push(brokenItem('「开投前追踪检查」最近一轮的回执读不出来（格式不对）——这一栏空着不等于没事。', INFRA_HOW))
    return { brokeRun: true, stop: false }
  }
  return { brokeRun: false, stop: false }
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

function fixItem(item: TrackingReceiptItem, nameOf: (id: string) => string): ManualItem {
  return {
    kind: 'ads_tracking_preflight_fix',
    client_id: item.client_id,
    client_name: nameOf(item.client_id),
    what: item.what,
    how: item.how,
    href: item.href,
  }
}

/**
 * 一个客户的开投前体检：没回执 / 回执过期 → 欠账（最近一轮自己已经出了欠账时不再叠一条，过期的回执里的红灯也不再下发）；
 * 回执新鲜 → 把里面的红灯原样下发，哪怕最近一轮是别的种类（读回 / 手动）的失败轮。
 */
function pushClientItems(
  rows: RunRow[],
  clientId: string,
  nameOf: (id: string) => string,
  now: Date,
  items: ManualItem[],
  runAlreadyBroken: boolean,
): void {
  const picked = pickLatestClientReceipt(rows, clientId)
  const clientName = nameOf(clientId)
  const href = promoPlanHref(clientId)

  if (picked === null) {
    if (!runAlreadyBroken) {
      items.push(brokenItem(
        `「开投前追踪检查」最近几轮里还没有 ${clientName} 的回执——这个客户的追踪现在没人在查。`,
        INFRA_HOW,
        clientId, clientName, href,
      ))
    }
    return
  }

  const age = receiptAgeHours(picked.receipt.checked_at, now)
  if (age === null || age > TRACKING_RECEIPT_STALE_HOURS) {
    if (!runAlreadyBroken) {
      const ageText = age === null ? '未知' : String(Math.round(age))
      items.push(brokenItem(
        `「开投前追踪检查」里 ${clientName} 的回执已 ${ageText} 小时没更新——追踪现在没人在查。`,
        INFRA_HOW,
        clientId, clientName, href,
      ))
    }
    return
  }

  for (const item of picked.receipt.items) items.push(fixItem(item, nameOf))
}

/** 一份开投后读回回执里的待办原样下发；超过 3 天的不再挂。 */
function pushFreshPostLaunchItems(
  picked: { receipt: TrackingClientReceipt },
  nameOf: (id: string) => string,
  now: Date,
  items: ManualItem[],
): void {
  const age = receiptAgeHours(picked.receipt.checked_at, now)
  if (age === null || age > POST_LAUNCH_ITEM_WINDOW_HOURS) return
  for (const item of picked.receipt.items) items.push(fixItem(item, nameOf))
}

/**
 * 开投后读回：每个客户看「该看的那一份」（最新的非灰，全灰才取最新的灰），红灯 / 黄灯（样本不足等）下发成待办。
 * 它不进推广计划看板，所以这里是它唯一的出口；超过 3 天的读回不再挂。
 *
 * 🔴 最新一份如果是「没读到」的灰灯（令牌失效 / 接口出错 / 范围被拒），它自带一条开发欠账，不能被更早的真红 / 黄灯盖住：
 *    更早的真信号和这条欠账一起出。最新一份只是「还没花钱」的灰灯（没有待办）则什么都不多出。
 */
function pushPostLaunchItems(
  rows: RunRow[],
  clientId: string,
  nameOf: (id: string) => string,
  now: Date,
  items: ManualItem[],
): void {
  const picked = pickLatestPostLaunchReceipt(rows, clientId)
  if (picked === null) return
  pushFreshPostLaunchItems(picked, nameOf, now, items)

  // 最新一份和「该看的那一份」不是同一份 = 最新一份是灰灯（它若不是灰，「该看的那一份」就是它自己）
  const newest = pickNewestPostLaunchReceipt(rows, clientId)
  if (newest !== null && newest.receipt !== picked.receipt) pushFreshPostLaunchItems(newest, nameOf, now, items)
}

// ─── 盯盘一直找不到本次系列 ─────────────────────────────────────────────────────

interface SeriesAlarmCandidate {
  clientId: string
  cfg: TrackingClientConfig
  expectedOn: string
}

/** 设了预计开投日、窗口还开着、且已过预计开投日 24 小时（按账户时区的日历日：今天的日期晚于预计开投日）的客户。 */
function seriesAlarmCandidates(clientIds: readonly string[], now: Date): SeriesAlarmCandidate[] {
  const out: SeriesAlarmCandidate[] = []
  for (const clientId of clientIds) {
    const cfg = getTrackingClientConfig(clientId)
    const watch = cfg?.launch_watch
    const expectedOn = watch?.expected_launch_on
    if (!cfg || !watch || !expectedOn) continue
    if (!isWatchActive(watch, now)) continue
    if (!(dateInTimezone(now, watch.timezone) > expectedOn)) continue
    out.push({ clientId, cfg, expectedOn })
  }
  return out
}

async function loadWatchRows(supabase: SupabaseClient, now: Date): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('status, started_at, error_message, summary')
    .eq('job_name', LAUNCH_WATCH_JOB)
    .gte('started_at', new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .order('started_at', { ascending: false })
    .limit(WATCH_LOOKBACK_ROWS)
  if (error) throw new Error(error.message)
  return (data ?? []) as RunRow[]
}

function adsManagerHref(adAccountId: string): string {
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${adAccountId.replace(/^act_/, '')}`
}

/**
 * 预计开投日已过 24 小时，盯盘一直找不到本次投放的系列（编号和名字关键词都对不上）→ 一条开发待办。
 * 没设预计开投日（开投日未定）不出：只在盯盘回执里记灰。读盯盘记录出任何问题都不出这条（也不抛错）——
 * 「盯盘函数自己没在跑」是另一回事，不能被说成「系列找不到」。
 */
async function pushSeriesNotFoundItems(
  supabase: SupabaseClient,
  clientIds: readonly string[],
  nameOf: (id: string) => string,
  now: Date,
  items: ManualItem[],
): Promise<void> {
  const candidates = seriesAlarmCandidates(clientIds, now)
  if (candidates.length === 0) return
  let rows: RunRow[]
  try {
    rows = await loadWatchRows(supabase, now)
  } catch {
    return
  }
  for (const { clientId, cfg, expectedOn } of candidates) {
    const status = seriesWatchStatusFromRows(rows, clientId)
    if (status.ticks < SERIES_ALARM_MIN_TICKS || status.ever_found || status.latest_found !== false) continue
    const latestMs = status.latest_at === null ? Number.NaN : Date.parse(status.latest_at)
    if (!Number.isFinite(latestMs) || now.getTime() - latestMs > SERIES_ALARM_MAX_TICK_AGE_MS) continue
    items.push({
      kind: 'ads_tracking_preflight_fix',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `开投后自动补排的盯盘：预计 ${expectedOn} 开投，已过 24 小时，在广告账户里一直没找到本次投放的系列（编号和名字关键词都对不上）——开投后的追踪读回不会自动排上。如果其实还没发布，这条是正常的，发布后会自动消失。`,
      how: '到广告管理工具看这个系列发布了没有：发布了，就把 src/lib/ads-tracking-preflight/client-config.ts 里 launch_watch 的 campaign_ids / campaign_name_contains 改成新的编号或名字关键词；还没发布，就把 expected_launch_on 改成新的预计开投日。',
      href: adsManagerHref(cfg.ad_account_id),
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
  const verdict = checkLatestRun(latest, now, items)
  if (verdict.stop) return

  reportRunSelfError(latest, items)

  // 只有「还在跑」的记录：一轮都还没收尾，不去喊「没有回执」
  const usable = rows.filter(r => r.status !== 'running')
  if (usable.length === 0) return

  for (const clientId of clientIds) {
    pushClientItems(usable, clientId, nameOf, now, items, verdict.brokeRun)
    pushPostLaunchItems(usable, clientId, nameOf, now, items)
  }
  await pushSeriesNotFoundItems(supabase, clientIds, nameOf, now, items)
}
