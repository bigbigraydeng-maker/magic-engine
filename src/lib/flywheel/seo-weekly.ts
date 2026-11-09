/**
 * 每周 SEO 快照 —— 派单 / 干活 两段的纯逻辑（PM 2026-09-07 拍板「开」）。
 *
 * 背景：这条链路的代码 2026-05-18 就写好了（P12.B.4），但**从来没跑过一次** ——
 * 生产库 cron_run_logs 里 `flywheel-seo-weekly` 是 0 条。2026-08-06 的架构审计把它
 * 标成「等 PM 拍板」，因为它每周要对每个在服务的客户各花一次 SEO 数据的钱。
 * 2026-09-07 PM 拍板开，并要求按 CLAUDE.md 的 Inngest 硬约束改成工作流。
 *
 * 🔴 **为什么要拆成「派单 + 干活」两段，而不是原来那样一个请求串着跑完**：
 *    原实现在一个 HTTP 请求里 for 循环跑完所有客户，`maxDuration = 900`。这形态有三个
 *    死法，而且死了都不留痕：跑到第 5 个客户超时 → 前 4 个写了、后面的没写，但运行记录
 *    只有一条「完成」；任何一个客户的 provider 调用卡住 → 整批陪葬；重试 = 已经付过钱的
 *    客户再付一次。拆开之后，每个客户是一个独立的、可重试的、带回执的单元。
 *
 * 🔴 **本文件不 import supabase、不 import adapter**：全部靠调用方注入。
 *    这样测试能直接跑纯函数，也让登记清单的对账测试可以只 import 调度常量而不拖起整个
 *    数据库连接（client 组件引服务端模块整页崩是本仓踩过的坑，同一类问题）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 云端专属事件名 —— 本机 factory-worker 不消费（见 lib/inngest/client.ts 的
 * WORKER_OWNED_EVENTS，契约测试锁死「一事件一主」）。
 */
export const FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT = 'flywheel/seo.snapshot.due'

/**
 * 派单的时刻表。**这里是唯一定义处**：Inngest 的 cron 触发器和登记清单都从这里取，
 * 登记清单的对账测试会断言两边一致 —— 不然改了一处忘了另一处，健康检查会按错的
 * 周期算逾期，而「算错的告警」跟「没有告警」一样没用。
 *
 * 每周一 05:15 新西兰时间：错开整点那一堆日更任务，也避开周日 17:00 的行业基准采集
 * （那条同样打 DataForSEO）。
 */
export const FLYWHEEL_SEO_WEEKLY_CRON = '15 5 * * 1'
export const FLYWHEEL_SEO_WEEKLY_TZ = 'Pacific/Auckland'

/** 写进 cron_run_logs 的名字。跟登记清单里的 jobName 必须一致。 */
export const FLYWHEEL_SEO_WEEKLY_JOB = 'flywheel-seo-weekly'

/**
 * 每个客户每次快照会打几次外部数据服务。
 *
 * 🔴 这个数字不是装饰：它是回执里「这一单花了多少」的唯一依据。
 *    `getDomainMetrics` 内部并发打两个接口（domain_rank_overview + backlinks/summary），
 *    改了那边这里必须同步改，否则回执会低报花费 —— 低报比不报更糟，因为它看起来是真的。
 */
export const PROVIDER_CALLS_PER_CLIENT = 2

/**
 * 每周快照**付费写入**的那几行在 `flywheel_metrics.source` 里的标记。
 *
 * 标记名 'semrush' 是历史遗留（数据其实来自 DataForSEO 的 domain_rank_overview +
 * backlinks/summary），为了跟已有的行和读方对得上而保留。写入方
 * （`SeoContentAdapter.pullMetrics`）和防重复扣费闸（`recentlySnapshotted`）都读这一个常量，
 * 两边永远一致。
 */
export const SEO_WEEKLY_PAID_SOURCE = 'semrush'

/** 派单名单里的一条。 */
export interface SnapshotRosterEntry {
  readonly clientId: string
  readonly domain: string
}

export type RosterResult =
  | { readonly ok: true; readonly entries: readonly SnapshotRosterEntry[] }
  | { readonly ok: false; readonly reason: string }

/**
 * 谁该被扫：**在服务中 + 填了网址**。
 *
 * 🔴 判据只有这两条，没有任何客户名。填了网址就会被扫，这是**已经存在**的规则，
 *    本次上线没有改它 —— 但它有一个已知副作用，PITFALLS 里记着：给一个不买 SEO 的
 *    客户随手填一个占位网址，就会把他静默拉进每周付费扫描。要排除某个客户，
 *    正确做法是清掉他的网址或改他的服务状态，不是在这里加一张名单。
 */
export async function loadSnapshotRoster(supabase: SupabaseClient): Promise<RosterResult> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('client_status', 'active')
    .contains('seo_config', { weekly_blog: true })
    .not('domain', 'is', null)

  if (error) return { ok: false, reason: error.message }

  const entries = (data ?? []).flatMap((row): SnapshotRosterEntry[] => {
    const clientId = (row as { id?: unknown }).id
    const domain = (row as { domain?: unknown }).domain
    if (typeof clientId !== 'string' || clientId.length === 0) return []
    if (typeof domain !== 'string' || domain.trim().length === 0) return []
    return [{ clientId, domain: domain.trim() }]
  })

  return { ok: true, entries }
}

/**
 * 至少隔多久才允许再扫同一个客户。
 *
 * 🔴 **这才是防重复扣费的真闸**。原来写的是「事件 id 按周去重，所以同一周补触发不会
 *    重复付款」—— 复审查了 Inngest 官方文档，**它的事件去重窗口只有 24 小时**，
 *    而「手动补触发」按定义就发生在隔天。也就是说那句话是错的，照着它点一下按钮，
 *    全体客户的数据钱会再花一遍，还不留痕迹。
 *
 * 用「距上次有数据不足 156 小时（6.5 天）就跳过」而不是「本自然周扫过就跳过」：
 * 后者要在夏令时和时区之间算周边界，算错一次就是全员多付一轮；前者没有任何日历math，
 * 而且 6.5 天 < 7 天，不会把下一次正常的周更挡掉。
 */
export const MIN_HOURS_BETWEEN_SNAPSHOTS = 156

/**
 * ISO 8601 周编号（`2026-W37`），**按新西兰时间算**。
 *
 * 🔴 必须按新西兰时间：定时器是 `TZ=Pacific/Auckland 15 5 * * 1`，新西兰的周一早上
 *    05:15 在 UTC 是**周日** 17:15 —— 按 UTC 算出来的周编号会整整落后一周，而且
 *    同一个新西兰周一的中午 12 点之后（UTC 跨到周一）算出来的编号又会变成下一周。
 *    编号一变，Inngest 那 24 小时的去重也拦不住，同一天就能把全体客户再扫一遍。
 *    复审实测出来的，不是推理。
 *
 * 用途：给条子一个稳定的编号（Inngest 24 小时内按 id 去重 = 第一道薄防线），
 * 以及让回执上写的「哪一周」跟实际运行的那一周对得上。
 * **真正防重复扣费的是上面的 MIN_HOURS_BETWEEN_SNAPSHOTS，不是这个编号。**
 */
export function isoWeekKey(date: Date): string {
  const nz = new Intl.DateTimeFormat('en-CA', {
    timeZone: FLYWHEEL_SEO_WEEKLY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  const [y, m, day] = nz.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, day))
  const dayNum = d.getUTCDay() || 7 // 周一=1 … 周日=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // 挪到本周的周四，ISO 周归属看周四
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * 这个客户最近扫过没有 —— **花钱之前必须过这一关**。
 *
 * 判据用 `flywheel_metrics` 里这个客户最近一条 SEO 记录的时间，不新建表：
 * 新建表要走 migration（不可逆、要 PM 拍板），而这张表本来就是这条链路的产物，
 * 「有没有本周的数据」跟「要不要再花一次钱」问的是同一件事。
 *
 * 🔴 **只看本快照自己付费写的那几行**（`source = SEO_WEEKLY_PAID_SOURCE`）。
 *    每天的 GSC / GA4 回拉也往这张表写 `flywheel = 'seo'` 的行；旧判据把它们当成
 *    「这周扫过了」，2026-09 的 W37–W39 三周两个客户全部 skipped、一行没写（生产实查）。
 *    博客篇数那一行（`source = 'blog_posts'`）不花钱，也不算。
 *
 * 🔴 **查不出来一律当成「扫过了」**（fail-closed 往不花钱的方向倒）。
 *    反过来写就是：数据库一抽风，全体客户当场多付一轮。宁可这周少一次数据。
 */
export async function recentlySnapshotted(
  supabase: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
): Promise<{ readonly skip: boolean; readonly reason: string | null; readonly lastAt: string | null }> {
  const cutoff = new Date(now.getTime() - MIN_HOURS_BETWEEN_SNAPSHOTS * 3_600_000).toISOString()
  const { data, error } = await supabase
    .from('flywheel_metrics')
    .select('measured_at')
    .eq('client_id', clientId)
    .eq('flywheel', 'seo')
    .eq('source', SEO_WEEKLY_PAID_SOURCE)
    .gte('measured_at', cutoff)
    .order('measured_at', { ascending: false })
    .limit(1)

  if (error) return { skip: true, reason: `lookup_failed:${error.message}`, lastAt: null }

  const row = (data ?? [])[0] as { measured_at?: unknown } | undefined
  const lastAt = typeof row?.measured_at === 'string' ? row.measured_at : null
  if (lastAt) return { skip: true, reason: 'snapshotted_recently', lastAt }
  return { skip: false, reason: null, lastAt: null }
}

/** 每客户每周一个的事件 id —— 只是 Inngest 那 24 小时去重的键，不是防重复扣费的闸。 */
export function snapshotEventId(clientId: string, weekKey: string, attempt?: string): string {
  const base = `flywheel-seo-${weekKey}-${clientId}`
  return attempt ? `${base}-${attempt}` : base
}

export interface SnapshotDueData {
  readonly client_id: string
  readonly domain: string
  readonly week_key: string
}

export type ParsedSnapshotDue =
  | { readonly ok: true; readonly value: SnapshotDueData }
  | { readonly ok: false; readonly reason: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WEEK_KEY_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/

/**
 * 收到的派单条子合不合法（fail-closed）。
 *
 * 🔴 缺字段一律拒，绝不「缺了当默认值继续」—— 这一段后面就是花钱的 provider 调用，
 *    拿一个来路不明的 client_id 去扫，扫的是谁的钱都说不清。
 */
export function parseSnapshotDue(raw: unknown): ParsedSnapshotDue {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'payload_not_object' }
  const d = raw as Record<string, unknown>
  if (typeof d.client_id !== 'string' || !UUID_RE.test(d.client_id)) {
    return { ok: false, reason: 'invalid_client_id' }
  }
  if (typeof d.domain !== 'string' || d.domain.trim().length === 0 || d.domain.length > 253) {
    return { ok: false, reason: 'invalid_domain' }
  }
  if (typeof d.week_key !== 'string' || !WEEK_KEY_RE.test(d.week_key)) {
    return { ok: false, reason: 'invalid_week_key' }
  }
  return { ok: true, value: { client_id: d.client_id, domain: d.domain.trim(), week_key: d.week_key } }
}

/**
 * 一个客户的快照回执。字段按 CLAUDE.md 对 Inngest 回执的要求来：
 * 谁（client_id / domain）· 哪一单（week_key）· 结果（status）· 花了多少
 * （provider_calls_max）· 有没有对外发布（no_publish 恒 true，这条链路只读取和入库）
 * · 什么时候（created_at）。
 */
export interface SnapshotReceipt {
  /**
   * · `completed`  真拿到并写下了数据
   * · `no_data`    一行都没写。**不算成功**：客户网址被清掉、或者数据源整段失灵，
   *                都长这样。混进 completed 里的话，「这周 SEO 数据全是 0」会被显示成健康。
   * · `skipped`    最近扫过了，这次不花钱（防重复扣费闸拦下的）
   * · `failed`     抛异常了
   */
  readonly status: 'completed' | 'no_data' | 'skipped' | 'failed'
  readonly client_id: string
  readonly domain: string
  readonly week_key: string
  readonly metrics_written: number
  /**
   * 🔴 是**上限**不是实数，名字里带 max 就是为了没人能把它当账单读。
   *    真实次数这一层看不到：`getDomainMetrics` 内部打两个接口，但客户网址被清掉时
   *    适配器会提前返回、一次都不打。要精确记账得让适配器自己报，那是另一件事
   *    （已单独记）。这里宁可说「最多这么多」，不说一个会被当真的数字。
   */
  readonly provider_calls_max: number
  readonly no_publish: true
  readonly error: string | null
  readonly created_at: string
}

/**
 * 干一个客户的活。
 *
 * 🔴 **失败也返回回执，不往外抛**：抛出去 Inngest 会重试，而 provider 那一笔钱已经花了 ——
 *    重试等于重复付款。这里把失败变成一条 status=failed 的回执。
 *
 * 🔴 **先过防重复扣费闸再干活**：`shouldSkip` 由调用方注入（生产传 recentlySnapshotted）。
 *    闸拦下就直接出 skipped 回执，一次外部调用都不发生。
 */
export async function snapshotOneClient(
  due: SnapshotDueData,
  pullMetrics: (clientId: string) => Promise<readonly unknown[]>,
  shouldSkip: (clientId: string) => Promise<{ skip: boolean; reason: string | null }>,
  now: Date = new Date(),
): Promise<SnapshotReceipt> {
  const base = {
    client_id: due.client_id,
    domain: due.domain,
    week_key: due.week_key,
    no_publish: true as const,
    created_at: now.toISOString(),
  }

  const gate = await shouldSkip(due.client_id)
  if (gate.skip) {
    return { ...base, status: 'skipped', metrics_written: 0, provider_calls_max: 0, error: gate.reason }
  }

  try {
    const rows = await pullMetrics(due.client_id)
    return {
      ...base,
      status: rows.length > 0 ? 'completed' : 'no_data',
      metrics_written: rows.length,
      provider_calls_max: PROVIDER_CALLS_PER_CLIENT,
      error: rows.length > 0 ? null : 'no_metrics_written',
    }
  } catch (err: unknown) {
    return {
      ...base,
      status: 'failed',
      metrics_written: 0,
      provider_calls_max: PROVIDER_CALLS_PER_CLIENT,
      error: err instanceof Error ? err.message : 'unknown_error',
    }
  }
}
