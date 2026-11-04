import { createHash, randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * 定时任务运行记录（cron_run_logs）的写入口。
 *
 * 🔴 这里的写失败**绝不能静默**。
 *    2026-09-07 实测（生产库 glbdnayojixmexgofbsd）：goals-expiry-check 由 GitHub Actions
 *    每天调度，8/18–8/30 这 13 次全部 HTTP 200、body 都是 {"success":true}，
 *    但 cron_run_logs 里只有 8/27 那一天留下了记录，另外 12 天一行都没有 ——
 *    首版只取了 `data`、没取 `error`，insert 一失败 runId 就是 null，
 *    `finish()` 直接 `return`，任务照常跑完却不留任何痕迹。
 *
 *    后果不是「少一条日志」，而是**健康检查反过来说谎**：health.ts 完全建立在
 *    cron_run_logs 上，没有行 = 「从来没跑过 / 逾期没跑」。
 *    误报一旦成为常态，真出事那天也会被当噪音划掉。
 *
 * 所以本模块有两条硬规则：
 *   1. 每一次写库都必须取 error 并 `console.error` 出来（进 Render 日志，人能看见）；
 *   2. 开跑那行不管插没插成，`finish()` 都必须落下一条**带终态**的记录 ——
 *      发现不许只死在日志里，必须回到健康检查看得见的同一根管道。
 *
 * 🔴 2026-09-08 补一刀：开跑那次 insert 如果是「服务端已提交、只是响应在回来的路上丢了」，
 *    Supabase SDK 一样会报网络错误，跟「insert 真的没进去」在调用方看来完全没法区分。
 *    旧版据此把 runId 判成 null，`finish()` 于是**另插一条**终态记录 —— 这行的
 *    `started_at` 用的是显式传入的开跑时刻，而真正落库的第一行 `started_at` 走的是建表
 *    DDL 的 `NOW()` 默认值（更晚）。health.ts 按 `started_at DESC` 只看最新一条，
 *    于是稳定选中那条第一次插入的孤儿行 —— 它永远停在 `running`，一小时后就被
 *    误报成「卡死」。
 *    修法：id 在**发起插入前**就在本地生成好（`randomUUID()`），开跑和收尾自始至终
 *    用同一个 id（这也是 `cronRunHandle` 必须知道这个 id 的原因）；收尾不再区分
 *    「插过 / 没插过」，一律用这个 id `upsert`。插过的话 upsert 落到同一行变成终态，
 *    没插过的话 upsert 把它插出来 —— 两种真实结果都收敛成一行，不会再产生孤儿记录。
 *
 * 写日志本身失败**不抛异常**：它是观测手段，不是安全闸，不该把正在跑的业务任务弄挂。
 */

export interface CronRunFinishOpts {
  processed?: number
  completed?: number
  failed?: number
  summary?: Record<string, unknown>
  error?: string
}

export interface CronRunHandle {
  /** 开跑时生成的 cron_run_logs.id。重叠的后一轮用它认出「哪一行是自己」。 */
  id: string
  finish(opts: CronRunFinishOpts): Promise<void>
}

/**
 * 一次跑里有的条目成了、有的条目没成 → `partial`。
 * 一条都没成，或整次抛了 → `failed`。全成（或空转）→ `completed`。
 *
 * 有 `error` 但 `failed` 为 0（例如出口坏了、人已经进了 CRM）仍是 `failed`，
 * 日报靠这个状态看见「没有可数失败对象、但这轮没干成」。
 */
export function resolveCronRunStatus(input: CronRunFinishOpts): 'completed' | 'partial' | 'failed' {
  const failed = input.failed ?? 0
  const completed = input.completed ?? 0
  if (failed > 0 && completed > 0) return 'partial'
  if (input.error || failed > 0) return 'failed'
  return 'completed'
}

function isStatusCheckViolation(error: { message: string; code?: string }): boolean {
  return error.code === '23514' || error.message.includes('cron_run_logs_status_check')
}

/** Supabase 的错误对象只保证有 message，其余字段按需带上，全部塞进一行日志里。 */
function describe(error: { message: string; code?: string; details?: string | null; hint?: string | null }): string {
  const parts = [error.message]
  if (error.code) parts.push(`code=${error.code}`)
  if (error.details) parts.push(`details=${error.details}`)
  if (error.hint) parts.push(`hint=${error.hint}`)
  return parts.join(' | ')
}

/**
 * 只开一行运行记录、把 id 交出去 —— 给**工作流函数**用。
 *
 * 🔴 为什么要有这个入口：Inngest 的函数体在每个步骤边界之后会从头重放一遍
 *    （步骤的结果走缓存，步骤**外**的代码每遍都真跑）。`startCronRun` 返回的是一个
 *    带闭包的 handle，没法放进步骤里跨重放传递；直接放在步骤外就会每重放一遍插一行，
 *    结果是每周留下一堆永远停在「在跑」的假记录 —— 而这套监控的全部价值就是那些记录
 *    是真的。所以工作流里改成：一个步骤开记录拿 id，另一个步骤按 id 收尾。
 */
export async function startCronRunId(jobName: string): Promise<string> {
  // id 自己生成、先于插入存在 —— 这样即使插入的响应在回来的路上丢了，
  // 调用方手里也已经攥着「如果插成功了，会是哪一行」的答案，收尾时能对上号。
  const id = randomUUID()
  const { error } = await supabaseAdmin
    .from('cron_run_logs')
    .insert({ id, job_name: jobName, status: 'running' })

  if (error) {
    console.error(
      `[cron-run-logger] ${jobName}: 开跑记录写不进 cron_run_logs（id=${id}）—— 若响应丢失但实际已提交，收尾会用同一个 id upsert 补齐，不会留孤儿记录。${describe(error)}`,
    )
  }

  return id
}

/** 用已知的 id + 开始时刻重建收尾用的 handle（配合 startCronRunId 跨步骤使用）。 */
export function cronRunHandle(jobName: string, runId: string, startedAt: number): CronRunHandle {
  return finisher(jobName, runId, startedAt)
}

export async function startCronRun(jobName: string): Promise<CronRunHandle> {
  const startedAt = Date.now()
  const runId = await startCronRunId(jobName)
  return finisher(jobName, runId, startedAt)
}

async function upsertCronOutcome(jobName: string, outcome: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from('cron_run_logs').upsert(outcome, { onConflict: 'id' })
  if (!error) return

  // `partial` / `abandoned` 要等状态约束的迁移应用之后才写得进。迁移还没上时，
  // 直接失败会把这一行永远留在 running —— 比「先记成 failed」更瞎。
  const status = String(outcome.status)
  if (isStatusCheckViolation(error) && (status === 'partial' || status === 'abandoned')) {
    const fallbackMessage = status === 'abandoned'
      ? `abandoned: ${outcome.error_message ?? 'still running past 2× expected duration'}`
      : `partial: ${outcome.error_message ?? `${outcome.failed_count ?? 0} item(s) failed`}`
    const { error: retryError } = await supabaseAdmin.from('cron_run_logs').upsert(
      { ...outcome, status: 'failed', error_message: fallbackMessage },
      { onConflict: 'id' },
    )
    if (!retryError) {
      console.error(
        `[cron-run-logger] ${jobName}: cron_run_logs 还不接受 status=${status}，已改写成 failed，避免停在 running。${describe(error)}`,
      )
      return
    }
    console.error(
      `[cron-run-logger] ${jobName}: 收尾写不进 cron_run_logs（id=${outcome.id}）—— 这次运行可能永远停在 running，或者彻底没有痕迹。${describe(retryError)}`,
    )
    return
  }

  console.error(
    `[cron-run-logger] ${jobName}: 收尾写不进 cron_run_logs（id=${outcome.id}）—— 这次运行可能永远停在 running，或者彻底没有痕迹。${describe(error)}`,
  )
}

function finisher(jobName: string, runId: string, startedAt: number): CronRunHandle {
  const startedAtIso = new Date(startedAt).toISOString()

  return {
    id: runId,
    async finish({ processed = 0, completed = 0, failed = 0, summary, error: jobError }) {
      const outcome = {
        id: runId,
        job_name: jobName,
        started_at: startedAtIso,
        status: resolveCronRunStatus({ failed, completed, error: jobError }),
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        processed,
        completed_count: completed,
        failed_count: failed,
        summary: summary ?? null,
        error_message: jobError ?? null,
      }

      // upsert 而不是「先判断插没插过再决定 insert/update」——开跑那次到底有没有真的
      // 提交，调用方并不确定（网络错误既可能是没插进去，也可能是插成功了但响应丢了）。
      // 用同一个 runId upsert：提交过就收敛成更新它，没提交过就把它插出来，
      // 两种真实结果都只落一行，不会再冒出第二条孤儿记录。
      await upsertCronOutcome(jobName, outcome)
    },
  }
}

/**
 * 把某个任务**还停在「在跑」的运行记录**统一收成 `failed` —— 给 Inngest 函数的 `onFailure` 用。
 *
 * 🔴 为什么按 job_name 而不是按 runId 收：`onFailure` 是 Inngest 另起的一次独立调用，
 *    拿不到主函数 `log-start` 那一步记在 step 缓存里的 runId。只要主函数配了
 *    `concurrency: { limit: 1 }`，同一时刻同名任务最多一行 `running`，按名字收不会误伤。
 *    `startedBefore` 再收一道口：只收在失败事件**之前**开跑的行 —— 人在后台点 Replay
 *    开的新一轮如果抢在这条收尾之前先写了 `running`，不会被错标成失败。
 *
 * 🔴 一行 `running` 都没有时（`log-start` 自己就被掐死了），仍然要落一条带终态的记录 ——
 *    这是本模块第二条硬规则（见文件头）；否则健康检查只会报「逾期没跑」，看不出是跑死了。
 *
 * 写失败**不抛异常**，跟 `finish()` 同样的理由：它是观测手段，不是安全闸。
 * 返回真正被改到的行数（0 = 新插了一条兜底记录）。
 */
export async function failOpenCronRuns(
  jobName: string,
  errorMessage: string,
  opts: { startedBefore: Date },
): Promise<number> {
  const finishedAt = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .update({ status: 'failed', finished_at: finishedAt, error_message: errorMessage })
    .eq('job_name', jobName)
    .eq('status', 'running')
    .lte('started_at', opts.startedBefore.toISOString())
    .select('id')

  if (error) {
    console.error(
      `[cron-run-logger] ${jobName}: onFailure 收口写不进 cron_run_logs —— 这次失败可能永远停在 running。${describe(error)}`,
    )
    return 0
  }

  const closed = data?.length ?? 0
  if (closed > 0) return closed

  const { error: insertError } = await supabaseAdmin.from('cron_run_logs').insert({
    id: randomUUID(),
    job_name: jobName,
    status: 'failed',
    started_at: opts.startedBefore.toISOString(),
    finished_at: finishedAt,
    error_message: errorMessage,
  })
  if (insertError) {
    console.error(
      `[cron-run-logger] ${jobName}: onFailure 兜底记录也写不进去 —— 这次失败彻底没有痕迹。${describe(insertError)}`,
    )
  }
  return 0
}

/**
 * 由 Inngest 的 run id 推出一个固定的 UUID，当这一轮的运行记录 id（以及需要对齐的回执 id）。
 *
 * 🔴 为什么要固定：`onFailure` 是 Inngest 另起的一次调用，拿不到主函数 `log-start` 步骤里
 *    记下的 id；它只拿得到 `event.data.run_id`。用同一个 run id 算出同一个 id，失败收口时就能
 *    **只收自己那一行**，不用再按任务名把所有「在跑」的行一起收掉（同名任务并发时会误伤别的单）。
 *    同一个 run 里重试的步骤也拿到同一个 id，所以开记录必须幂等（见 startCronRunWithId）。
 *
 * 做法：sha256(runId) 取前 32 个十六进制字符，排成 8-4-4-4-12。
 */
export function cronRunIdFromInngestRun(runId: string): string {
  const hex = createHash('sha256').update(runId).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * 用调用方给定的 id 开一行运行记录（给 Inngest 工作流用，id 来自 cronRunIdFromInngestRun）。
 *
 * 🔴 幂等：同一个 run 里 `log-start` 步骤重试时会拿同一个 id 再插一次——插入已经提交、只是响应
 *    丢了的情况下，第二次会撞主键（23505）。那不是错误，是「已经开过了」，静默返回。
 * 其他写失败照本模块的规矩：`console.error` 喊出来、不抛（收尾时 finish() 按同一个 id upsert 兜底）。
 */
export async function startCronRunWithId(jobName: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin.from('cron_run_logs').insert({ id, job_name: jobName, status: 'running' })
  if (!error || error.code === '23505') return
  console.error(
    `[cron-run-logger] ${jobName}: 开跑记录写不进 cron_run_logs（id=${id}）—— 收尾会用同一个 id upsert 补齐。${describe(error)}`,
  )
}

/**
 * 按 id 收尾**一行**运行记录，除非它已经是终态 —— 给知道自己 run id 的 `onFailure` 用。
 *
 * · 这一行还在 `running`，或者压根没插成（开跑那步就挂了）→ 用 finish() 的同一套 upsert 落成终态，
 *   `started_at` 沿用库里那一行的（没有这一行才用 `fallbackStartedAt`），不把开跑时刻改成失败时刻；
 * · 这一行已经是 completed / failed → 不动，返回 'already_terminal'（不许把真结果覆盖掉）。
 * 读不出来时照样落终态（宁可覆盖一次，也不留一行永远「在跑」）。写失败不抛，理由同 finish()。
 */
export async function finishCronRunIfOpen(
  jobName: string,
  id: string,
  opts: Parameters<CronRunHandle['finish']>[0],
  fallbackStartedAt: Date,
): Promise<'closed' | 'already_terminal'> {
  const { data, error } = await supabaseAdmin.from('cron_run_logs').select('status, started_at').eq('id', id)
  if (error) {
    console.error(`[cron-run-logger] ${jobName}: 收口前读不出运行记录（id=${id}），照样落终态。${describe(error)}`)
  }
  const row = (data ?? [])[0] as { status?: unknown; started_at?: unknown } | undefined
  if (row && row.status !== 'running') return 'already_terminal'
  const parsed = typeof row?.started_at === 'string' ? Date.parse(row.started_at) : Number.NaN
  const startedAt = Number.isNaN(parsed) ? fallbackStartedAt.getTime() : parsed
  await finisher(jobName, id, startedAt).finish(opts)
  return 'closed'
}
