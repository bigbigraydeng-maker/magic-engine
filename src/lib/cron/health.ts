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
import { fetchAll } from '@/lib/supabase-paginate'
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
   *
   * 🔴 **一个任务可能有多条**（见 stuckRunsByJob 的注释），所以这里按服务聚合过：
   *    一个服务一条，`rounds` 说清它在窗口里卡了几轮。
   *    不聚合的话 `stuck.length` 说的是「几条记录」而不是「几个任务」——
   *    attribution-cron 一家 4 条孤儿行会被渲染成「**4 个**自动任务卡死」，
   *    是个会骗人的数（魏征 2026-09-23 复审 M5）。
   */
  stuck: StuckService[]
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
 * 往回看多久的卡死记录。
 *
 * 🔴 这个窗口是**唯一的边界**，不能不写：孤儿行永远不会被谁改好 ——
 *    没有任何代码会回头给 `status='running'` 的行补 `finished_at`，
 *    而清理任务只删「7 天以上 + `status='completed'` + 什么都没留下」的行
 *    （20260907000001），碰不到它们，只有 180 天硬上限才删。
 *    不设窗口 = 这条待办会把几个月的陈年孤儿行天天摆一遍。
 */
const STUCK_WINDOW_MS = 48 * 60 * 60 * 1000

/**
 * 「最近一次运行」批量查询的回看窗口。
 *
 * 3 天足够覆盖所有日更及更勤的任务；周更/月更任务落不进窗口，会走各自的
 * 单任务索引查询兜底（见 latestRunsByJob），所以窗口小不会漏判。
 */
const WINDOW_MS = 3 * 24 * 60 * 60 * 1000

/** 一个服务在窗口里卡死的汇总（一个服务一条，不是一条记录一条）。 */
export interface StuckService {
  service: string
  /** 窗口里**最早**那一轮的开跑时间 —— 卡最久的那轮最值得看 */
  startedAt: string
  /** 距最早那轮多少分钟 */
  minutesRunning: number
  /** 窗口里卡了几轮。这个数是全量查出来的，不是抽样估的，可以报 */
  rounds: number
}

interface LastOutcome {
  status: string
  error: string | null
  startedAt: string
  finishedAt: string | null
}

interface RunRow {
  job_name: string
  status: string
  error_message: string | null
  started_at: string
  finished_at: string | null
}

function toLastOutcome(r: RunRow): LastOutcome {
  return { status: r.status, error: r.error_message, startedAt: r.started_at, finishedAt: r.finished_at }
}

/** 单任务兜底：走 `(job_name, started_at DESC)` 复合索引，取最近一条。 */
async function latestRunForJob(supabase: SupabaseClient, name: string): Promise<LastOutcome | null> {
  const { data } = await supabase
    .from('cron_run_logs')
    .select('job_name, status, error_message, started_at, finished_at')
    .eq('job_name', name)
    .order('started_at', { ascending: false })
    .limit(1)
  const r = (data ?? [])[0] as RunRow | undefined
  return r ? toLastOutcome(r) : null
}

/**
 * 每个任务**最近一次**的结果 —— 只有最后一次失败才算「现在是坏的」。
 *
 * 🔴 不能用「拉最近 N 条再分组」那种写法(首版就是,当场翻车)：
 *    高频任务两周能写 4400 条,窗口全被它们占满,周更任务的记录根本进不来 ——
 *    于是一批一直在跑的任务被判成「从来没跑过」。
 *    **误报一旦成为常态,真出事那天也会被当噪音划掉。**
 *
 * 现在的做法：一次分页查询拉回 `WINDOW_MS` 窗口内所有任务的运行记录（按
 * `started_at` 倒序，所以每个 job_name 第一次出现的那行就是它窗口内的最近一次），
 * 窗口里没出现的任务（周更/月更/已停摆）再各自走一次带索引的单任务查询兜底。
 * 窗口查询因此不会像「全局拉最近 N 条」那样被高频任务挤占 —— 挤不进来的任务
 * 有自己的兜底路径，答案跟逐任务查询完全一致。
 *
 * 窗口查询报错时，退回**全部**任务逐条查：宁可慢，也不返回半份 map。
 */
async function latestRunsByJob(
  supabase: SupabaseClient,
  jobNames: string[],
  now: Date,
): Promise<Map<string, LastOutcome>> {
  const out = new Map<string, LastOutcome>()
  if (jobNames.length === 0) return out

  const sinceIso = new Date(now.getTime() - WINDOW_MS).toISOString()
  let windowRows: RunRow[] | null = null
  try {
    const rows = await fetchAll<RunRow>(
      (from, to) =>
        supabase
          .from('cron_run_logs')
          .select('job_name, status, error_message, started_at, finished_at')
          .in('job_name', jobNames)
          .gte('started_at', sinceIso)
          .order('started_at', { ascending: false })
          .range(from, to),
      20_000,
    )
    windowRows = rows
  } catch (e) {
    console.error(
      `[cron-health] 批量查最近运行失败，退回逐任务查询: ${e instanceof Error ? e.message : String(e)}`,
    )
    windowRows = null
  }

  if (windowRows) {
    // 倒序返回：每个 job 第一次出现即窗口内最近一次，后面的行忽略
    for (const r of windowRows) {
      if (!out.has(r.job_name)) out.set(r.job_name, toLastOutcome(r))
    }
  }

  const missing = windowRows ? jobNames.filter((n) => !out.has(n)) : jobNames
  const fallback = await Promise.all(missing.map(async (name) => [name, await latestRunForJob(supabase, name)] as const))
  for (const [name, v] of fallback) if (v) out.set(name, v)
  return out
}

/**
 * 窗口内「开跑了但没有结束时间」的所有轮次 —— 卡死判据的输入。
 *
 * WHY 不能沿用上面 `lastOutcome()` 的「只看最后一条」
 * ------------------------------------------------
 * 卡死会被下一轮成功**自动掩埋**：`attribution-cron` 2026-09-22 卡死两轮，
 * 18:00 那轮成功了，19:01 体检只看见成功 —— 于是两轮没干的活儿等于没发生。
 * 任何跑得比体检（每天 19:01）更勤的任务都有这个毛病。
 *
 * WHY 这么改**不会**把 lastRunByJob 注释里警告的那种误报带回来
 * ---------------------------------------------------------
 * 1. 语义上它们根本不是同一类主张。「失败了、后来修好了」是**同一个主张的更新**，
 *    后一次成功确实推翻前一次，所以 `failing` 只认最后一次是对的（那条一个字不改）。
 *    而「开跑了、从来没结束」是**一段已经过去的窗口里活儿没干成**，
 *    后一次成功补不回那一轮，也没有任何代码会回头给那行补 `finished_at` ——
 *    它是永久孤儿行，不是一个会过期的状态。
 * 2. 仍然是**一个任务一条查询**。原注释警告的误报是「全局拉最近 N 条再分组」
 *    被高频任务挤占窗口（两周 4400 条），导致周更任务被判「从来没跑过」——
 *    一任务一查，结构上不存在挤占。`cron_run_logs` 上有 `(job_name, started_at DESC)`
 *    复合索引（20260606000011），走得上。
 * 3. `isStuck` 判据一个字不改：`running` + `finished_at IS NULL` + 开跑超 60 分钟。
 *    对「正在正常跑的那一次」永远为假（全仓最长 maxDuration 是 900 秒）。
 * 4. 48 小时窗口有界，陈年孤儿行进不来。
 */
export interface StuckRunRow {
  status: string
  startedAt: string
  finishedAt: string | null
}

export type StuckProber = (jobName: string, sinceIso: string) => Promise<StuckRunRow[]>

export function makeSupabaseStuckProber(supabase: SupabaseClient): StuckProber {
  return async (jobName: string, sinceIso: string): Promise<StuckRunRow[]> => {
    const { data, error } = await supabase
      .from('cron_run_logs')
      .select('status, started_at, finished_at')
      .eq('job_name', jobName)
      .eq('status', 'running')
      .is('finished_at', null)
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: true })
      .limit(200)
    if (error) {
      // 查不了是我们这侧的问题，不能当成「没有卡死」—— 留一行，别静默
      console.error(`[cron-health] 查 ${jobName} 的卡死记录失败: ${error.message}`)
      return []
    }
    return ((data ?? []) as Array<{ status: string; started_at: string; finished_at: string | null }>).map(
      (r) => ({ status: r.status, startedAt: r.started_at, finishedAt: r.finished_at }),
    )
  }
}

/**
 * 把一个服务窗口内的卡死轮次压成一条。纯函数，可完全单测。
 *
 * 取**最早**那轮的开跑时间：卡最久的那轮最值得看，也让「已卡 N 小时」这个数
 * 说的是这件事真实持续了多久。
 */
export function collapseStuckRuns(service: string, rows: StuckRunRow[], now: Date): StuckService | null {
  const stuckRows = rows.filter((r) => isStuck(r, now))
  if (stuckRows.length === 0) return null
  const earliest = stuckRows.reduce((a, b) =>
    new Date(a.startedAt).getTime() <= new Date(b.startedAt).getTime() ? a : b,
  )
  return {
    service,
    startedAt: earliest.startedAt,
    minutesRunning: Math.round((now.getTime() - new Date(earliest.startedAt).getTime()) / 60000),
    rounds: stuckRows.length,
  }
}

async function stuckByService(
  prober: StuckProber,
  now: Date,
): Promise<StuckService[]> {
  const sinceIso = new Date(now.getTime() - STUCK_WINDOW_MS).toISOString()
  const found = await Promise.all(
    CRON_REGISTRY.map(async (e) => collapseStuckRuns(e.service, await prober(e.jobName, sinceIso), now)),
  )
  return found.filter((s): s is StuckService => s !== null)
}

interface StuckRow {
  job_name: string
  status: string
  started_at: string
  finished_at: string | null
}

/**
 * 跟 `stuckByService` 同语义，但只发**一次**分页查询：把窗口内所有任务的
 * `running` 孤儿行一次拉回，再按 job_name 分组喂给 `collapseStuckRuns`。
 *
 * 判据（`isStuck`）和聚合方式（按服务、取最早那轮）一个字不改 —— 只是把
 * 「一任务一查」换成「一次查完再分组」。查询报错时打一行日志并返回 []，
 * 跟旧 prober 的行为一致（查不了不能当成「没有卡死」，但也不能让体检整体挂掉）。
 */
async function stuckByServiceBatch(supabase: SupabaseClient, now: Date): Promise<StuckService[]> {
  const jobNames = Array.from(new Set(CRON_REGISTRY.map((e) => e.jobName)))
  if (jobNames.length === 0) return []
  const sinceIso = new Date(now.getTime() - STUCK_WINDOW_MS).toISOString()

  let rows: StuckRow[]
  try {
    rows = await fetchAll<StuckRow>(
      (from, to) =>
        supabase
          .from('cron_run_logs')
          .select('job_name, status, started_at, finished_at')
          .in('job_name', jobNames)
          .eq('status', 'running')
          .is('finished_at', null)
          .gte('started_at', sinceIso)
          .order('started_at', { ascending: true })
          .range(from, to),
      5_000,
    )
  } catch (e) {
    console.error(
      `[cron-health] 批量查卡死记录失败: ${e instanceof Error ? e.message : String(e)}`,
    )
    return []
  }

  const byJob = new Map<string, StuckRunRow[]>()
  for (const r of rows) {
    const list = byJob.get(r.job_name) ?? []
    list.push({ status: r.status, startedAt: r.started_at, finishedAt: r.finished_at })
    byJob.set(r.job_name, list)
  }

  const found = CRON_REGISTRY.map((e) => collapseStuckRuns(e.service, byJob.get(e.jobName) ?? [], now))
  return found.filter((s): s is StuckService => s !== null)
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
      if (target.emptyRoundsAreLegitimate && !(await hadDueWork(entry.jobName, new Date(0)))) continue
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
      // 🔴 空轮豁免**只对显式声明过的任务**生效（Codex 复审 2026-09-23 P2）：
      //    `processed=0` 在不同任务里不是同一个意思，无条件套用会把
      //    `google-data-pullback-daily` 的数据源断线又藏回去 —— 那正是当初
      //    加这套判据要抓的事故。判据见 registry 的 `emptyRoundsAreLegitimate`。
      if (target.emptyRoundsAreLegitimate && !(await hadDueWork(entry.jobName, lastRowAt))) continue
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
  const [outcomes, silentSuccess, stuck] = await Promise.all([
    latestRunsByJob(supabase, names, now),
    // 卡死判定用主干那份（48 小时窗口全量扫、按服务汇总），本分支原来那版
    // 「只看回退 60 分钟后最新一条」已删 —— 主干那份同样修掉小时级任务的盲点，
    // 还额外接住「卡死被下一轮成功掩埋」那种形态。
    checkDownstreamFreshness(makeSupabaseProber(supabase), now, makeSupabaseRunActivityReader(supabase)),
    stuckByServiceBatch(supabase, now),
  ])

  const inputs: JobHealthInput[] = CRON_REGISTRY.map((e) => {
    const outcome = outcomes.get(e.jobName)
    return {
      service: e.service,
      jobName: e.jobName,
      schedule: e.schedule,
      logsRuns: e.logsRuns,
      lastRunAt: outcome ? new Date(outcome.startedAt) : null,
      registeredAt: e.addedAt ? new Date(`${e.addedAt}T00:00:00Z`) : null,
    }
  })

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
