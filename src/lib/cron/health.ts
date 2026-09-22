/**
 * 定时任务健康检查 —— 回答「按时跑了没有」。
 *
 * PM 2026-08-03：「我希望你自检这些工作，如何能确保按时完成，如果不能完成需要有报错」。
 *
 * 跟现有 daily-cron-digest 的区别（也是它的盲区）：
 *   digest 报的是「跑了但失败」。这里报的是「**该跑却没跑**」——
 *   后者没有任何记录，所以在 digest 眼里它跟「一切正常」完全一样。
 *   工厂排产停摆 8 天、daily-cron-digest 自己哑 51 天，都是死在这个盲区。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { CRON_REGISTRY, type CronOutputTable } from './registry'
import { unhealthyJobs, type JobHealth, type JobHealthInput } from './schedule'

/**
 * "跑成了但没写出东西" —— 2026-09-23 事故的那个盲区。
 *
 * 场景：`google-data-pullback-daily` 每天 `cron_run_logs.status='completed'`，
 * 但下游 `ad_health_narratives` 从 9/20 起一行没写。上游数据源断了 →
 * 路由里的写这一步被跳过 → judgeJob 只看 cron 状态放行 → 断了 3 天没人察觉。
 *
 * 这类由 registry 里的 `outputTables` 声明配合本字段一起兜住：
 * 声明了目标表 + 下游超过 `freshnessHours` 没新行 = silent_success。
 */
export interface SilentSuccess {
  service: string
  jobName: string
  table: string
  /** 目标表里最新一行的时间；从来没写过传 null */
  lastRowAt: string | null
  /** 距最新一行多少小时；从来没写过传 null */
  hoursSince: number | null
  /** 阈值（从 registry outputTables[i].freshnessHours 抄来，方便前端展示） */
  freshnessHours: number
  /** 中文一句话，直接可读 */
  detail: string
}

export interface HealthReport {
  checkedAt: string
  total: number
  /** 看不见的（代码没写运行记录）—— 必须单独摆出来 */
  blind: JobHealth[]
  /** 从来没跑过 */
  neverRan: JobHealth[]
  /** 逾期没跑 */
  overdue: JobHealth[]
  /** 调度表达式看不懂 */
  unknown: JobHealth[]
  /**
   * **最近一次**就是失败的（跟上面互不重叠：这类是跑了但没跑成）。
   *
   * 🔴 判据是「最后一次的结果」，不是「窗口内失败过几次」——
   *    site-audit-cron 两周内失败 11 次，但 8/1 起已连续成功三天（那个 bug 当天修的）。
   *    按「失败过就报」会把已经修好的东西天天摆出来，人一旦学会忽略它，
   *    真坏的那天也会被一起忽略。
   */
  failing: { service: string; lastError: string | null }[]
  /**
   * **最近一次卡死在半路**：状态还是 `running`、`finished_at` 为空，而开跑已经很久了。
   *
   * 🔴 这是 `failing` 和 `overdue` 之间的一道缝，两边都接不住：
   *    `failing` 只认 `status='failed'`（路由自己的 catch 写的），可容器被杀时那行
   *    catch 根本没机会执行，状态就永远停在 `running`；`overdue` 看的是 `started_at`，
   *    而卡死的任务**开跑记录是有的**，所以也不算逾期。
   *    结果：跑死的任务在体检报告里等于健康 —— 正是本文件开头声讨的那个盲区，换了个形状。
   *
   *    真实规模（2026-09-06 查生产，60 天窗口）：9 个任务共 30 条卡死行，
   *    最多的 messenger-brief-hourly 一家 15 条；attribution-cron 2026-09-02 18:00
   *    那轮卡了 4 天没人发现。
   */
  stuck: { service: string; startedAt: string; minutesRunning: number }[]
  /**
   * **跑成了但下游表没新行** —— 2026-09-23 事故对应的病态。
   *
   * 只对 registry 里声明了 `outputTables` 的条目做检查；未声明 = 不查（跟老行为一致）。
   * 一个 job 声明了 N 张表，每张表各判一次，各出一条 SilentSuccess。
   */
  silentSuccess: SilentSuccess[]
}

/**
 * 跑多久还没结束就算卡死。
 *
 * 全仓 cron 路由里最长的 `maxDuration` 是 900 秒（15 分钟），取 60 分钟 = 4 倍余量：
 * 正常慢跑不会被误报，真卡死最迟一小时内现形。
 */
const STUCK_AFTER_MS = 60 * 60 * 1000

/**
 * 每个任务各查一次「最近一次运行」。
 *
 * 🔴 不能用「拉最近 N 条再分组」那种写法(首版就是,当场翻车)：
 *    高频任务两周能写 4400 条,窗口全被它们占满,周更任务的记录根本进不来 ——
 *    于是一批一直在跑的任务被判成「从来没跑过」。
 *    **误报一旦成为常态,真出事那天也会被当噪音划掉。**
 *
 * 40 个各查一条带索引的小查询,并发跑,代价远低于误报。
 */
async function lastRunByJob(supabase: SupabaseClient, jobNames: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  const results = await Promise.all(
    jobNames.map(async (name) => {
      const { data } = await supabase
        .from('cron_run_logs')
        .select('started_at')
        .eq('job_name', name)
        .order('started_at', { ascending: false })
        .limit(1)
      const row = (data ?? [])[0] as { started_at: string } | undefined
      return [name, row ? new Date(row.started_at) : null] as const
    }),
  )
  for (const [name, at] of results) if (at) out.set(name, at)
  return out
}

interface LastOutcome {
  status: string
  error: string | null
  startedAt: string
  finishedAt: string | null
}

/** 每个任务**最近一次**的结果 —— 只有最后一次失败才算「现在是坏的」。 */
async function lastOutcome(
  supabase: SupabaseClient,
  jobNames: string[],
): Promise<Map<string, LastOutcome>> {
  const out = new Map<string, LastOutcome>()
  const rows = await Promise.all(
    jobNames.map(async (name) => {
      const { data } = await supabase
        .from('cron_run_logs')
        .select('status, error_message, started_at, finished_at')
        .eq('job_name', name)
        .order('started_at', { ascending: false })
        .limit(1)
      const r = (data ?? [])[0] as
        | { status: string; error_message: string | null; started_at: string; finished_at: string | null }
        | undefined
      return [
        name,
        r
          ? { status: r.status, error: r.error_message, startedAt: r.started_at, finishedAt: r.finished_at }
          : null,
      ] as const
    }),
  )
  for (const [name, v] of rows) if (v) out.set(name, v)
  return out
}

/**
 * 查每个声明了 outputTables 的 job，其目标表最新一行的时间。
 *
 * 🔴 一表一查，Promise.all 并行 —— 跟 lastRunByJob 同样的策略：
 *    "拉最近 N 条再分组"这种写法在高频写入的表上会踩空，让稀有事件被淹没。
 *    有索引的小查询 × N 张表，代价可控。
 *
 * 查不到（表不存在 / 权限不够 / 查询报错）时返回 `{ error }`，让上层区分
 * "从来没写过（合法状态）" vs "查不了（问题在查询侧）"—— 后者不能默认当成
 * "下游 stale" 报出去，否则会天天误报（跟 blind vs never_ran 同一个道理）。
 */
export interface DownstreamProbe {
  lastRowAt: Date | null
  error: string | null
}

/**
 * 一张表探针的抽象：测试传 fake 函数、生产传 supabase 实现。
 *
 * 这样拆是因为 SupabaseClient 的类型体过于庞大，测试里造一个满足它整套类型的
 * 假客户端很难做到形状一致（memory [as-unknown-as-hides-shape-mismatch] 讲过
 * 走强转硬糊会让 fixture 悄悄漂移）。用一个窄函数接口就完全绕开这个问题：
 * fixture 只需要按需返回 DownstreamProbe，一次一张表。
 */
export type DownstreamProber = (target: CronOutputTable) => Promise<DownstreamProbe>

export function makeSupabaseProber(supabase: SupabaseClient): DownstreamProber {
  return async (target: CronOutputTable): Promise<DownstreamProbe> => {
    const col = target.timestampColumn ?? 'updated_at'
    try {
      const { data, error } = await supabase
        .from(target.table)
        .select(col)
        .order(col, { ascending: false })
        .limit(1)
      if (error) return { lastRowAt: null, error: error.message }
      // Supabase v2 的 data 类型 infer 复杂，用 type guard 逐步收窄比强转干净：
      // 每一步失败都是"表存在但为空"，属合法状态，报 lastRowAt=null 让上层判"从没写过"
      if (!Array.isArray(data) || data.length === 0) return { lastRowAt: null, error: null }
      const row = data[0]
      if (row === null || typeof row !== 'object') return { lastRowAt: null, error: null }
      const raw = (row as Record<string, unknown>)[col]
      if (typeof raw !== 'string') return { lastRowAt: null, error: null }
      const at = new Date(raw)
      if (Number.isNaN(at.getTime())) return { lastRowAt: null, error: `无法解析时间：${raw}` }
      return { lastRowAt: at, error: null }
    } catch (e) {
      return { lastRowAt: null, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

/**
 * 只把"真的 stale"的抽出来。查不到（error 非空）不算 stale —— 单独报，
 * 由前端决定摆在哪。查得到但从来没写过（lastRowAt=null, error=null）当作 stale
 * 报出来 —— 一张有 outputTables 声明的表却零行，多半就是我们要抓的沉默死。
 */
export async function checkDownstreamFreshness(
  prober: DownstreamProber,
  now: Date = new Date(),
): Promise<SilentSuccess[]> {
  const targets = CRON_REGISTRY.flatMap((e) =>
    (e.outputTables ?? []).map((t) => ({ entry: e, target: t })),
  )
  if (targets.length === 0) return []

  const probes = await Promise.all(targets.map((t) => prober(t.target)))

  const out: SilentSuccess[] = []
  for (let i = 0; i < targets.length; i++) {
    const { entry, target } = targets[i]
    const { lastRowAt, error } = probes[i]

    // 查询出错单独报，别默认当成 stale
    if (error) {
      out.push({
        service: entry.service,
        jobName: entry.jobName,
        table: target.table,
        lastRowAt: null,
        hoursSince: null,
        freshnessHours: target.freshnessHours,
        detail: `无法查 ${target.table} 的最新一行：${error}`,
      })
      continue
    }

    if (!lastRowAt) {
      out.push({
        service: entry.service,
        jobName: entry.jobName,
        table: target.table,
        lastRowAt: null,
        hoursSince: null,
        freshnessHours: target.freshnessHours,
        detail: `${target.table} 一行都没有 —— 这个任务声明了要写这张表，从没写过`,
      })
      continue
    }

    const hoursSince = (now.getTime() - lastRowAt.getTime()) / 3_600_000
    if (hoursSince > target.freshnessHours) {
      out.push({
        service: entry.service,
        jobName: entry.jobName,
        table: target.table,
        lastRowAt: lastRowAt.toISOString(),
        hoursSince,
        freshnessHours: target.freshnessHours,
        detail: `${target.table} 已经 ${hoursSince.toFixed(1)} 小时没新行（阈值 ${target.freshnessHours}h）—— 任务可能跑成了但没写下去，先查上游数据源`,
      })
    }
  }
  return out
}

export async function checkCronHealth(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<HealthReport> {
  const names = Array.from(new Set(CRON_REGISTRY.map((e) => e.jobName)))
  const [lastRun, outcomes, silentSuccess] = await Promise.all([
    lastRunByJob(supabase, names),
    lastOutcome(supabase, names),
    checkDownstreamFreshness(makeSupabaseProber(supabase), now),
  ])

  const inputs: JobHealthInput[] = CRON_REGISTRY.map((e) => ({
    service: e.service,
    jobName: e.jobName,
    schedule: e.schedule,
    logsRuns: e.logsRuns,
    lastRunAt: lastRun.get(e.jobName) ?? null,
    registeredAt: e.addedAt ? new Date(`${e.addedAt}T00:00:00Z`) : null,
  }))

  const bad = unhealthyJobs(inputs, now)

  return {
    checkedAt: now.toISOString(),
    total: CRON_REGISTRY.length,
    blind: bad.filter((h) => h.state === 'blind'),
    neverRan: bad.filter((h) => h.state === 'never_ran'),
    overdue: bad.filter((h) => h.state === 'overdue'),
    unknown: bad.filter((h) => h.state === 'unknown_schedule'),
    failing: CRON_REGISTRY
      .filter((e) => outcomes.get(e.jobName)?.status === 'failed')
      .map((e) => ({ service: e.service, lastError: outcomes.get(e.jobName)?.error ?? null })),
    stuck: CRON_REGISTRY.flatMap((e) => {
      const o = outcomes.get(e.jobName)
      if (!o || !isStuck(o, now)) return []
      return [{
        service: e.service,
        startedAt: o.startedAt,
        minutesRunning: Math.round((now.getTime() - new Date(o.startedAt).getTime()) / 60000),
      }]
    }),
    silentSuccess,
  }
}

/**
 * 最近一次是不是卡死了：还挂着 `running`、没有结束时间、且开跑超过 STUCK_AFTER_MS。
 *
 * 三个条件缺一不可。只看 `status='running'` 会把**正在正常跑**的那一次报成卡死
 * —— 体检本身常常就在某个任务的执行窗口里跑。
 */
export function isStuck(
  o: { status: string; finishedAt: string | null; startedAt: string },
  now: Date,
): boolean {
  if (o.status !== 'running' || o.finishedAt !== null) return false
  const started = new Date(o.startedAt).getTime()
  if (Number.isNaN(started)) return false
  return now.getTime() - started > STUCK_AFTER_MS
}

/** 说人话的一句话结论 —— 给待办和周报用，不要求看的人懂 cron。 */
export function summarise(r: HealthReport): string {
  const problems: string[] = []
  if (r.neverRan.length) problems.push(`${r.neverRan.length} 个从来没跑过`)
  if (r.overdue.length) problems.push(`${r.overdue.length} 个该跑没跑`)
  if (r.failing.length) problems.push(`${r.failing.length} 个在报错`)
  if (r.stuck.length) problems.push(`${r.stuck.length} 个跑到一半卡死`)
  if (r.silentSuccess.length) problems.push(`${r.silentSuccess.length} 个跑成了但没写出东西`)
  if (r.blind.length) problems.push(`${r.blind.length} 个查不出跑没跑`)
  if (problems.length === 0) return `${r.total} 个自动任务全部正常`
  return `${r.total} 个自动任务里：${problems.join('、')}`
}
