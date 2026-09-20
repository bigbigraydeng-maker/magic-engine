/**
 * 每周竞品快照 —— 派单 / 干活 两段的纯逻辑（PM 2026-09-20 拍板「开」，先只给 CTS）。
 *
 * 背景：`competitor_snapshots` 这张表 2026-05-18 就建好了，唯一的写入方是一个纯手动的
 * POST 接口，从来没有 cron；那个接口本身在 2026-08-05 的死管道清理里被当成陪葬一起删掉
 * 了（它主要是往已归档的 `keywords` 表写，`competitor_snapshots` 那部分插入是顺手陪葬的）。
 * 2026-09-20 审计发现表是空的，PM 拍板重写这段写入逻辑并接上定时任务。
 *
 * 结构照抄 src/lib/flywheel/seo-weekly.ts 的「派单 + 干活」两段拆分（同样理由：单个
 * HTTP 请求里 for 循环跑完所有客户会超时陪葬、失败不留痕、重试 = 重复花钱）。
 *
 * 🔴 本文件不 import supabase、不 import DataForSEO 客户端：全部靠调用方注入，
 *    测试能直接跑纯函数。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isoWeekKey } from '@/lib/flywheel/seo-weekly'

export { isoWeekKey }

/** 云端专属事件名 —— 本机 factory-worker 不消费（见 lib/inngest/client.ts 的 WORKER_OWNED_EVENTS）。 */
export const COMPETITOR_WATCH_DUE_EVENT = 'competitor/watch.due'

/**
 * 派单的时刻表。**这里是唯一定义处**，Inngest 的 cron 触发器和登记清单都从这里取。
 *
 * 每周一新西兰时间 05:45：紧跟在每周 SEO 快照（05:15）后面错开半小时，
 * 那条只是派单、几秒钟就结束，不会真的撞车。
 */
export const COMPETITOR_WATCH_CRON = '45 5 * * 1'
export const COMPETITOR_WATCH_TZ = 'Pacific/Auckland'

/** 写进 cron_run_logs 的名字。跟登记清单里的 jobName 必须一致。 */
export const COMPETITOR_WATCH_JOB = 'competitor-watch-weekly'

/**
 * 每个客户每次快照最多扫多少个竞品域名。
 *
 * 跟 CompetitorSnapshotAdapter 用的上限一致（那边也是同一个 resolver，同一类「别默认 5
 * 个截断掉 CTS 配的 19 个」的坑）。resolver 的默认 max 是 5，这里必须显式传更大的值。
 */
export const MAX_COMPETITOR_DOMAINS = 50

/** 至少隔多久才允许再扫同一个客户 —— 同 flywheel-seo-weekly 的 MIN_HOURS_BETWEEN_SNAPSHOTS，
 *  理由一致：Inngest 事件去重窗口只有 24 小时，「本自然周扫过」要算时区，容易错。
 *  156 小时（6.5 天）< 7 天，不会挡下一次正常的周更。 */
export const MIN_HOURS_BETWEEN_WATCHES = 156

/** 派单名单里的一条。 */
export interface WatchRosterEntry {
  readonly clientId: string
  readonly semrushDb: string | null
}

export type RosterResult =
  | { readonly ok: true; readonly entries: readonly WatchRosterEntry[] }
  | { readonly ok: false; readonly reason: string }

/**
 * 谁该被扫：**在服务中 + `seo_config.competitor_watch_enabled=true`**。
 *
 * 🔴 只给已经显式开了开关的客户扫 —— 不像 weekly_blog 那样默认对所有填了网址的客户生效。
 *    这是本次 PM 拍板的边界：先只给 CTS 一个客户花这笔 DataForSEO 的钱，别的客户要单独开。
 */
export async function loadWatchRoster(supabase: SupabaseClient): Promise<RosterResult> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, semrush_db, seo_config')
    .eq('client_status', 'active')
    .contains('seo_config', { competitor_watch_enabled: true })

  if (error) return { ok: false, reason: error.message }

  const entries = (data ?? []).flatMap((row): WatchRosterEntry[] => {
    const clientId = (row as { id?: unknown }).id
    if (typeof clientId !== 'string' || clientId.length === 0) return []
    const semrushDb = (row as { semrush_db?: unknown }).semrush_db
    return [{ clientId, semrushDb: typeof semrushDb === 'string' ? semrushDb : null }]
  })

  return { ok: true, entries }
}

/**
 * 这个客户最近扫过没有 —— 花钱之前必须过这一关。
 *
 * 判据直接查 `competitor_snapshots` 自己最近一条这个客户的记录：不新建表、不借别的表，
 * 「有没有本周的快照」跟「要不要再花一次钱」问的是同一件事（同 recentlySnapshotted 的理由）。
 *
 * 🔴 查不出来一律当成「扫过了」（fail-closed 往不花钱的方向倒）。
 */
export async function recentlyWatched(
  supabase: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
): Promise<{ readonly skip: boolean; readonly reason: string | null }> {
  const cutoff = new Date(now.getTime() - MIN_HOURS_BETWEEN_WATCHES * 3_600_000).toISOString()
  const { data, error } = await supabase
    .from('competitor_snapshots')
    .select('created_at')
    .eq('client_id', clientId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) return { skip: true, reason: `lookup_failed:${error.message}` }
  if ((data ?? []).length > 0) return { skip: true, reason: 'watched_recently' }
  return { skip: false, reason: null }
}

/** 每客户每周一个的事件 id —— 只是 Inngest 那 24 小时去重的键，不是防重复扣费的闸。 */
export function watchEventId(clientId: string, weekKey: string, attempt?: string): string {
  const base = `competitor-watch-${weekKey}-${clientId}`
  return attempt ? `${base}-${attempt}` : base
}

export interface WatchDueData {
  readonly client_id: string
  readonly week_key: string
}

export type ParsedWatchDue =
  | { readonly ok: true; readonly value: WatchDueData }
  | { readonly ok: false; readonly reason: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WEEK_KEY_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/

/** 收到的派单条子合不合法（fail-closed）—— 缺字段一律拒，不猜默认值。 */
export function parseWatchDue(raw: unknown): ParsedWatchDue {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload_not_object' }
  const d = raw as Record<string, unknown>
  if (typeof d.client_id !== 'string' || !UUID_RE.test(d.client_id)) {
    return { ok: false, reason: 'invalid_client_id' }
  }
  if (typeof d.week_key !== 'string' || !WEEK_KEY_RE.test(d.week_key)) {
    return { ok: false, reason: 'invalid_week_key' }
  }
  return { ok: true, value: { client_id: d.client_id, week_key: d.week_key } }
}

/** 一次快照写入的结果 —— 由注入的 takeSnapshot 返回，干活函数据此判定回执状态。 */
export interface SnapshotOutcome {
  readonly domainsScanned: number
  readonly keywordsWritten: number
}

/**
 * 一个客户的快照回执。字段按 CLAUDE.md 对 Inngest 回执的要求来：
 * 谁（client_id）· 哪一单（week_key）· 结果（status）· 花了多少（domains_scanned）
 * · 有没有对外发布（no_publish 恒 true）· 什么时候（created_at）。
 */
export interface WatchReceipt {
  /**
   * · `completed` 真拿到并写下了数据
   * · `no_data`   扫了但一条关键词都没写（配的竞品域名是空的、或者数据源没返回任何满足
   *               门槛的结果）—— 不算成功，别混进 completed
   * · `skipped`   最近扫过了，这次不花钱（防重复扣费闸拦下的）
   * · `failed`    抛异常了
   */
  readonly status: 'completed' | 'no_data' | 'skipped' | 'failed'
  readonly client_id: string
  readonly week_key: string
  readonly domains_scanned: number
  readonly keywords_written: number
  readonly no_publish: true
  readonly error: string | null
  readonly created_at: string
}

/**
 * 干一个客户的活。
 *
 * 🔴 失败也返回回执，不往外抛：抛出去 Inngest 会重试，而 provider 那一笔钱已经花了——
 *    重试等于重复付款。
 * 🔴 先过防重复扣费闸再干活：`shouldSkip` 由调用方注入（生产传 recentlyWatched）。
 */
export async function runOneClientWatch(
  due: WatchDueData,
  takeSnapshot: (clientId: string) => Promise<SnapshotOutcome>,
  shouldSkip: (clientId: string) => Promise<{ skip: boolean; reason: string | null }>,
  now: Date = new Date(),
): Promise<WatchReceipt> {
  const base = {
    client_id: due.client_id,
    week_key: due.week_key,
    no_publish: true as const,
    created_at: now.toISOString(),
  }

  const gate = await shouldSkip(due.client_id)
  if (gate.skip) {
    return { ...base, status: 'skipped', domains_scanned: 0, keywords_written: 0, error: gate.reason }
  }

  try {
    const outcome = await takeSnapshot(due.client_id)
    return {
      ...base,
      status: outcome.keywordsWritten > 0 ? 'completed' : 'no_data',
      domains_scanned: outcome.domainsScanned,
      keywords_written: outcome.keywordsWritten,
      error: outcome.keywordsWritten > 0 ? null : 'no_keywords_written',
    }
  } catch (err: unknown) {
    return {
      ...base,
      status: 'failed',
      domains_scanned: 0,
      keywords_written: 0,
      error: err instanceof Error ? err.message : 'unknown_error',
    }
  }
}
