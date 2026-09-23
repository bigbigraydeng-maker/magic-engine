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
  stuck: StuckRun[]
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

export interface LastOutcome {
  status: string
  error: string | null
  startedAt: string
  finishedAt: string | null
}

/**
 * 每个任务**最近一次**的结果 —— 只有最后一次失败才算「现在是坏的」。
 *
 * `startedBefore` 只取在那个时刻**之前**开跑的那一条（不传 = 不限）。卡死判定要用它，
 * 理由见 `lastSettleableOutcome`。
 */
async function lastOutcome(
  supabase: SupabaseClient,
  jobNames: string[],
  startedBefore?: Date,
): Promise<Map<string, LastOutcome>> {
  const out = new Map<string, LastOutcome>()
  const rows = await Promise.all(
    jobNames.map(async (name) => {
      let q = supabase
        .from('cron_run_logs')
        .select('status, error_message, started_at, finished_at')
        .eq('job_name', name)
      if (startedBefore) q = q.lt('started_at', startedBefore.toISOString())
      const { data } = await q.order('started_at', { ascending: false }).limit(1)
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
 * 读「某个任务在 `startedBefore` 之前最近一次运行」的抽象。
 *
 * 跟 `DownstreamProber` 完全同样的理由抽成窄函数：SupabaseClient 的类型体太大，
 * 测试里造一个满足它整套类型的假客户端做不到形状一致。卡死判定现在跑在这个接口上，
 * 测试直接传 fake，不碰 supabase。
 */
export type OutcomeReader = (jobName: string, startedBefore: Date | null) => Promise<LastOutcome | null>

export function makeSupabaseOutcomeReader(supabase: SupabaseClient): OutcomeReader {
  return async (jobName, startedBefore) => {
    const m = await lastOutcome(supabase, [jobName], startedBefore ?? undefined)
    return m.get(jobName) ?? null
  }
}

export interface StuckRun {
  service: string
  startedAt: string
  minutesRunning: number
}

/**
 * 挑出卡死在半路的任务。
 *
 * 🔴 **判据看的不是「最新一条」，是「最近一条早该跑完了的」**（2026-09-23 事故的
 *    「看不见」那一半）：`isStuck` 要求开跑满 60 分钟才算卡死（不然会把正在正常跑的
 *    那一次报成卡死）。可每小时任务**每小时都会新插一行 `running`**，所以它的
 *    「最新一条」永远不满 60 分钟 —— 这道判定对所有小时级任务**结构性地永远不成立**。
 *
 *    实测代价：`messenger-brief-hourly` 从 2026-09-20 19:11 起每小时留下一行永远
 *    停在 `running` 的记录，攒到 50 行、客户需求卡停产 3 天，而体检报告上 `stuck`
 *    一条都没有 —— 每小时都被那行「刚开跑 20 分钟、完全正常」的新记录挡在前面。
 *
 *    改法：把视线往回退 60 分钟，只看那条线之前最新的一条。它要么已经有终态（健康），
 *    要么就是真的卡死了；而正在跑的那一次还没跨过这条线，根本不在视野里 ——
 *    原来防误报的那层保护一并保住，不是拿误报换灵敏。
 */
export async function checkStuckRuns(
  read: OutcomeReader,
  now: Date,
  entries: readonly { service: string; jobName: string }[] = CRON_REGISTRY,
): Promise<StuckRun[]> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS)
  const rows = await Promise.all(entries.map((e) => read(e.jobName, cutoff)))
  const out: StuckRun[] = []
  for (let i = 0; i < entries.length; i++) {
    const o = rows[i]
    if (!o || !isStuck(o, now)) continue
    out.push({
      service: entries[i].service,
      startedAt: o.startedAt,
      minutesRunning: Math.round((now.getTime() - new Date(o.startedAt).getTime()) / 60000),
    })
  }
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
 * 窗口内这个任务有没有"本该写点什么"的一轮 —— 判据是 `cron_run_logs.processed`。
 *
 * 🔴 加这一层是因为 Codex 审出的漏洞（2026-09-23）：`messenger-brief-hourly`
 *    连续 3 小时没有新对话、或所有对话已有最新简报时，会合法地 `processed=0`
 *    收工 —— `conversation_briefs.generated_at` 本来就不该前进。旧版
 *    `checkDownstreamFreshness` 只看表新鲜度，会把这种正常空轮次当成
 *    「任务跑成了但没写东西」持续报错，天天生成一条没人能处理的人工待办。
 *
 *    判据用 `processed`（不是 `completed_count`）：这一列在各任务里记的是
 *    「这一轮挑出了几个候选」，0 就是「这一轮本来就没有该处理的东西」——
 *    跟这一轮到底写成了几条是两件事。窗口内只要有一次 `processed > 0`
 *    但表还是没新行，就还是要报：候选是有的，只是没写下去。
 */
export interface RunActivityProbe {
  /** 窗口内是否存在证据表明这一轮本该产出（某次运行 processed > 0） */
  hadDueWork: boolean
  /** 查不出来时给出原因；查不出来时按旧行为处理（当作可能有该产出的一轮），别默认放行 */
  error: string | null
}

/**
 * 读某个任务从 `since` 到现在，运行记录里有没有 `processed > 0` 的一轮。
 *
 * 抽成窄函数的理由跟 `DownstreamProber` 一样：测试直接传 fake，不用造一个
 * 满足 SupabaseClient 整套类型的假客户端。
 */
export type RunActivityReader = (jobName: string, since: Date) => Promise<RunActivityProbe>

export function makeSupabaseRunActivityReader(supabase: SupabaseClient): RunActivityReader {
  return async (jobName, since) => {
    const { data, error } = await supabase
      .from('cron_run_logs')
      .select('processed')
      .eq('job_name', jobName)
      .eq('status', 'completed')
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false })
      .limit(50)
    if (error) return { hadDueWork: true, error: error.message }
    const hadDueWork = (data ?? []).some((r) => ((r as { processed: number | null }).processed ?? 0) > 0)
    return { hadDueWork, error: null }
  }
}

/**
 * 只把"真的 stale"的抽出来。查不到（error 非空）不算 stale —— 单独报，
 * 由前端决定摆在哪。查得到但从来没写过（lastRowAt=null, error=null）当作 stale
 * 报出来 —— 一张有 outputTables 声明的表却零行，多半就是我们要抓的沉默死。
 *
 * `activityReader` 不传时保持老行为（不做「本轮是否应产出」的判断）——
 * 现有测试和还没接上运行回执的调用方不受影响。
 */
export async function checkDownstreamFreshness(
  prober: DownstreamProber,
  now: Date = new Date(),
  activityReader?: RunActivityReader,
): Promise<SilentSuccess[]> {
  const targets = CRON_REGISTRY.flatMap((e) =>
    (e.outputTables ?? []).map((t) => ({ entry: e, target: t })),
  )
  if (targets.length === 0) return []

  const probes = await Promise.all(targets.map((t) => prober(t.target)))

  // 查不到「未写过」情形的窗口用不设下限，覆盖这张表存在以来的全部运行记录；
  // 「stale」情形从最后一次写入开始查，只覆盖真正的空窗期。
  const hadDueWork = async (jobName: string, since: Date): Promise<boolean> => {
    if (!activityReader) return true
    const probe = await activityReader(jobName, since)
    // 查不出来时不默认放行——维持旧行为，照样按表新鲜度报
    return probe.error ? true : probe.hadDueWork
  }

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
      if (!(await hadDueWork(entry.jobName, new Date(0)))) continue
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
      if (!(await hadDueWork(entry.jobName, lastRowAt))) continue
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
  const [lastRun, outcomes, stuck, silentSuccess] = await Promise.all([
    lastRunByJob(supabase, names),
    lastOutcome(supabase, names),
    checkStuckRuns(makeSupabaseOutcomeReader(supabase), now),
    checkDownstreamFreshness(makeSupabaseProber(supabase), now, makeSupabaseRunActivityReader(supabase)),
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
    // 🔴 卡死判定单独走 `checkStuckRuns`（它看的是回退 60 分钟之后最新的那一条，
    //    不是 `outcomes` 里的最新一条）—— 为什么见那个函数的注释。
    stuck,
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
