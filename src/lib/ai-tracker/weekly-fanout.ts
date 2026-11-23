/**
 * 每周 AI 可见度追踪（GEO）—— 派单 / 干活 两段的纯逻辑。
 *
 * 背景：这条链路现在是 `ai-tracker-weekly`（`src/app/api/cron/ai-tracker-weekly/route.ts`），
 * 一个 Render 定时任务打一个 HTTP 端点，端点里一个 for 循环串行跑完全部客户的
 * `runTracker()`（`src/lib/ai-tracker/orchestrator.ts`，判断逻辑本身不在本次改动范围内）。
 * 跟 flywheel-seo-weekly 改造前一模一样的三个死法：跑到中途超时 → 前面几个客户写了、
 * 后面的没写，但运行记录只有一条；某个客户的 provider 调用卡住 → 整批陪葬；
 * 重试 = 已经付过钱的客户再付一次。本文件把它拆成「派单 + 干活」两段，跟
 * flywheel-seo-weekly / competitor-watch 同一个结构（理由见 flywheel/seo-weekly.ts 文件头）。
 *
 * 🔴 **本文件不 import supabase、不 import provider 客户端**：全部靠调用方注入，
 *    测试能直接跑纯函数（同 watch.ts / seo-weekly.ts 的理由）。
 *
 * 🔴 **判断逻辑不动**：干活那一步原样调用现有的 `runTracker()`
 *    （client-brand-match.ts 的品牌命中修复，issue #1823/#1837），本文件只决定
 *    「该不该跑、跑完写不写、写成什么样的回执」，不改它判断出来的任何结果。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isoWeekKey } from '@/lib/flywheel/seo-weekly'

export { isoWeekKey }

/**
 * 云端专属事件名 —— 本机 factory-worker 不消费（见 lib/inngest/client.ts 的
 * WORKER_OWNED_EVENTS，契约测试锁死「一事件一主」）。
 */
export const AI_VISIBILITY_TRACKER_DUE_EVENT = 'ai-visibility/tracker.due'

/**
 * 派单的时刻表。**这里是唯一定义处**，Inngest 的 cron 触发器和登记清单都从这里取。
 *
 * 新西兰时间每周一 06:00：紧跟在每周 SEO 快照（05:15）、竞品快照（05:45）后面错开，
 * 三条都只是派单、几秒钟就结束，不会真的撞车。跟旧 Render cron 的既定意图一致——
 * render.yaml 里 `ai-tracker-weekly` 当前排的是 `0 18 * * 0` UTC（PM 2026-09-16 拍板
 * 「NZ 早晨窗口」，等于 NZST 周一 06:00），这里保留同一个时间点，不改「几点跑」这件事，
 * 只改「怎么跑」。
 */
export const AI_VISIBILITY_WEEKLY_CRON = '0 6 * * 1'
export const AI_VISIBILITY_WEEKLY_TZ = 'Pacific/Auckland'

/**
 * 写进 cron_run_logs 的名字。**故意跟旧 Render cron 的 `ai-tracker-weekly` 不同名**——
 * 两条链路在灰度期间会并存（旧的对所有客户跑，新的只对开了
 * `seo_config.ai_visibility_inngest_enabled` 的客户跑），共用一个 job 名会把两条完全不同
 * 覆盖范围的运行记录混进同一份健康检查里，看不出「这周到底是哪条链路给这个客户出的数据」。
 */
export const AI_VISIBILITY_WEEKLY_JOB = 'ai-visibility-tracker-weekly'

/**
 * 每个客户每次追踪最多打几次 LLM provider。
 *
 * 🔴 这个数字只是回执里「上限」的估算依据，不是账单：`runTracker` 内部按
 *    `engines.length × queries.length` 打 runner，再按成功的 runner 数打 parser——
 *    真实次数取决于这个客户配了多少条已启用的问题，派单这一步还不知道。
 *    回执用 `runs_attempted`（来自 `runTracker` 自己的返回值）报真实规模，这个常量只用于
 *    派单阶段的「估算」字段，跟 flywheel-seo-weekly 的 PROVIDER_CALLS_PER_CLIENT 同一类做法。
 */
export const ENGINES_PER_CLIENT = 2

/** 派单名单里的一条。 */
export interface TrackerRosterEntry {
  readonly clientId: string
}

export type RosterResult =
  | { readonly ok: true; readonly entries: readonly TrackerRosterEntry[] }
  | { readonly ok: false; readonly reason: string }

/**
 * 谁该被扫：**在服务中 + 至少有一条已启用的追踪问题 + 显式开了
 * `seo_config.ai_visibility_inngest_enabled`**。
 *
 * 🔴 前两条判据原样照抄旧 Render cron 的选人逻辑（`ai-tracker-weekly/route.ts`）：
 *    先看哪些客户在 `ai_visibility_queries` 里有 `enabled=true` 的问题，再过一遍
 *    `client_status='active'`。这不是巧合——要让新旧两条链路对同一个客户产出「同样的
 *    判断结果」，派单这一步选中的必须是完全同一批客户，多一个少一个都会让对比失去意义。
 *
 * 🔴 第三条判据是本次新加的灰度闸门：不像旧 cron 那样默认对所有满足前两条的客户生效——
 *    没有显式打开开关的客户，继续走旧 Render cron，一个不变。这是 PM 拍板的边界，跟
 *    `meta_cycle_enabled` / `competitor_watch_enabled` 同一个模式。
 */
export async function loadTrackerRoster(supabase: SupabaseClient): Promise<RosterResult> {
  const { data: queryRows, error: queryErr } = await supabase
    .from('ai_visibility_queries')
    .select('client_id')
    .eq('enabled', true)

  if (queryErr) return { ok: false, reason: queryErr.message }

  const candidateIds = Array.from(
    new Set(
      (queryRows ?? []).flatMap((row): string[] => {
        const id = (row as { client_id?: unknown }).client_id
        return typeof id === 'string' && id.length > 0 ? [id] : []
      }),
    ),
  )

  if (candidateIds.length === 0) return { ok: true, entries: [] }

  const { data: clientRows, error: clientErr } = await supabase
    .from('clients')
    .select('id, seo_config')
    .in('id', candidateIds)
    .eq('client_status', 'active')
    .contains('seo_config', { ai_visibility_inngest_enabled: true })

  if (clientErr) return { ok: false, reason: clientErr.message }

  const entries = (clientRows ?? []).flatMap((row): TrackerRosterEntry[] => {
    const clientId = (row as { id?: unknown }).id
    if (typeof clientId !== 'string' || clientId.length === 0) return []
    return [{ clientId }]
  })

  return { ok: true, entries }
}

/**
 * 至少隔多久才允许再扫同一个客户 —— 花钱之前必须过这一关。
 *
 * 跟 MIN_HOURS_BETWEEN_SNAPSHOTS / MIN_HOURS_BETWEEN_WATCHES 同一个理由：Inngest 的事件
 * 去重窗口只有 24 小时，「手动补触发」按定义就发生在隔天，事件 id 去重挡不住重复付费。
 * 156 小时（6.5 天）< 7 天，不会挡下一次正常的周更。
 */
export const MIN_HOURS_BETWEEN_RUNS = 156

/**
 * 这个客户最近追踪过没有 —— 判据查 `ai_visibility_snapshots` 自己最近一条这个客户的
 * `created_at`（不新建表：这张表本来就是 `runTracker` 每次成功都会 upsert 的产物）。
 *
 * 🔴 查不出来一律当成「扫过了」（fail-closed 往不花钱的方向倒），同 recentlySnapshotted /
 *    recentlyWatched 的理由：数据库一抽风，不该变成全体客户当场多付一轮 provider 的钱。
 */
export async function recentlyTracked(
  supabase: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
): Promise<{ readonly skip: boolean; readonly reason: string | null }> {
  const cutoff = new Date(now.getTime() - MIN_HOURS_BETWEEN_RUNS * 3_600_000).toISOString()
  const { data, error } = await supabase
    .from('ai_visibility_snapshots')
    .select('created_at')
    .eq('client_id', clientId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) return { skip: true, reason: `lookup_failed:${error.message}` }
  if ((data ?? []).length > 0) return { skip: true, reason: 'tracked_recently' }
  return { skip: false, reason: null }
}

/** 每客户每周一个的事件 id —— 只是 Inngest 那 24 小时去重的键，不是防重复扣费的闸。 */
export function trackerEventId(clientId: string, weekKey: string, attempt?: string): string {
  const base = `ai-visibility-tracker-${weekKey}-${clientId}`
  return attempt ? `${base}-${attempt}` : base
}

export interface TrackerDueData {
  readonly client_id: string
  readonly week_key: string
}

export type ParsedTrackerDue =
  | { readonly ok: true; readonly value: TrackerDueData }
  | { readonly ok: false; readonly reason: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WEEK_KEY_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/

/** 收到的派单条子合不合法（fail-closed）—— 缺字段一律拒，不猜默认值。 */
export function parseTrackerDue(raw: unknown): ParsedTrackerDue {
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

/**
 * `runTracker` 的返回值形状（只取干活函数需要原样透传进回执的字段）。
 *
 * 🔴 特意只声明这几个字段、不 import `RunTrackerResult` 本体——本文件不碰判断逻辑，
 *    也不该因为 orchestrator.ts 改了返回值的其它字段（比如加一个跟本回执无关的字段）
 *    就被迫重新过一遍类型检查。生产接线（ai-visibility-weekly.ts）传真实 `runTracker`，
 *    它的返回值结构上兼容这个形状。
 */
export interface TrackerRunOutcome {
  readonly runs_attempted: number
  readonly runs_succeeded: number
  readonly runs_failed: number
  readonly client_brand_mentions: number
  readonly total_cost_usd: number
  readonly snapshot_id: string | null
  /**
   * 为什么这次没算出数字（`runTracker` 给的原话，没有就是 null）。
   *
   * 🔴 这个字段必须进回执：引擎答了但解析全挂、或者读库/写快照失败时，
   *    `runs_succeeded` 仍然大于 0（引擎确实答了），可是一个数字都没落库。
   *    只看 `runs_succeeded` 会把这种情况写成 `completed`、`error: null`，
   *    真因只活在 console 里 —— 那正是「发现死在日志里」。
   */
  readonly snapshot_skipped_reason: string | null
}

/**
 * 一个客户的追踪回执。字段按 CLAUDE.md 对 Inngest 回执的要求来：
 * 谁（client_id）· 哪一单（week_key）· 结果（status）· 花了多少（total_cost_usd）
 * · 有没有对外发布（no_publish 恒 true，这条链路只读取和入库）· 什么时候（created_at）。
 */
export interface TrackerReceipt {
  /**
   * · `completed` `runTracker` 至少成功跑完一次、**而且写下了快照**
   * · `no_data`   跑了但没能产出数字——一次都没成功（比如全部 provider 超时），
   *               或者跑成了但没有一条完整到可以算数（比如解析全挂）。
   *               判据是 `snapshot_id`，不是 `runs_succeeded`：没快照就是没数。
   * · `skipped`   最近追踪过了，这次不花钱（防重复扣费闸拦下的）
   * · `failed`    `runTracker` 本身抛出异常了（比如这个客户一条启用的问题都没有）
   */
  readonly status: 'completed' | 'no_data' | 'skipped' | 'failed'
  readonly client_id: string
  readonly week_key: string
  readonly runs_attempted: number
  readonly runs_succeeded: number
  readonly runs_failed: number
  readonly client_brand_mentions: number
  readonly total_cost_usd: number
  readonly snapshot_id: string | null
  readonly no_publish: true
  readonly error: string | null
  readonly created_at: string
}

/**
 * 干一个客户的活。
 *
 * 🔴 **失败也返回回执，不往外抛**：抛出去 Inngest 会重试，而 provider 那一笔钱可能已经
 *    花了——重试等于重复付款。`runTracker` 内部会为「没有已启用的问题」这种情况抛异常
 *    （orchestrator.ts 的既有行为，本文件不改），这里原样捕获、转成 status=failed 的回执。
 *
 * 🔴 **先过防重复扣费闸再干活**：`shouldSkip` 由调用方注入（生产传 recentlyTracked）。
 *
 * 🔴 **不重新判断，只原样转述**：`runTracker` 返回什么就照抄进回执的对应字段，
 *    这里不重新计算、不过滤、不四舍五入——判断结果是它的，不是这一层的。
 */
export async function runOneClientTracker(
  due: TrackerDueData,
  runTracker: (input: { client_id: string }) => Promise<TrackerRunOutcome>,
  shouldSkip: (clientId: string) => Promise<{ skip: boolean; reason: string | null }>,
  now: Date = new Date(),
): Promise<TrackerReceipt> {
  const base = {
    client_id: due.client_id,
    week_key: due.week_key,
    no_publish: true as const,
    created_at: now.toISOString(),
  }

  const gate = await shouldSkip(due.client_id)
  if (gate.skip) {
    return {
      ...base,
      status: 'skipped',
      runs_attempted: 0,
      runs_succeeded: 0,
      runs_failed: 0,
      client_brand_mentions: 0,
      total_cost_usd: 0,
      snapshot_id: null,
      error: gate.reason,
    }
  }

  try {
    const result = await runTracker({ client_id: due.client_id })
    // 有快照才叫 completed。`runs_succeeded > 0` 不够：引擎答了但解析全挂时
    // 它照样大于 0，而那一周一个数字都没落库。
    const produced = result.snapshot_id !== null
    return {
      ...base,
      status: produced ? 'completed' : 'no_data',
      runs_attempted: result.runs_attempted,
      runs_succeeded: result.runs_succeeded,
      runs_failed: result.runs_failed,
      client_brand_mentions: result.client_brand_mentions,
      total_cost_usd: result.total_cost_usd,
      snapshot_id: result.snapshot_id,
      // 原因照抄 runTracker 的原话；它没给原话才退回笼统的 no_successful_runs。
      error: produced ? null : result.snapshot_skipped_reason ?? 'no_successful_runs',
    }
  } catch (err: unknown) {
    return {
      ...base,
      status: 'failed',
      runs_attempted: 0,
      runs_succeeded: 0,
      runs_failed: 0,
      client_brand_mentions: 0,
      total_cost_usd: 0,
      snapshot_id: null,
      error: err instanceof Error ? err.message : 'unknown_error',
    }
  }
}
