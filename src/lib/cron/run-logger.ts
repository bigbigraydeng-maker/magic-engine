import { randomUUID } from 'node:crypto'
import { CRON_REGISTRY } from '@/lib/cron/registry'
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
 * 🔴 2026-09-23 再补一刀：**部署换机会把在途请求连同收尾代码一起杀掉。**
 *    实测（Render 服务 crazycontent，实例级日志）：9/22 03:01:04 开跑的 `blog-weekly`
 *    正在逐个客户生成博客草稿，新实例 03:02:12.695 上线，旧实例 `…-2zsx6` 的日志
 *    停在 03:02:38.501 —— 正好是 oztop 那篇写进库的前 0.5 秒。排在后面的 CTS Tours NZ
 *    一个字都没生成，而 `finish()` 从头到尾没机会执行，运行记录**永远停在 running**。
 *    ⚠️ **口径更正（复审查出来的，原来写错了）**：不是「没有任何告警」。`health.ts` 的
 *    `stuck` 判据（running + finished_at 空 + 超 1 小时）命中了，也确实进了当天的今日待办
 *    —— 9/22 19:01 那封信实测 `total_items=170`，它是其中一条。问题是那条说的是
 *    「N 个自动任务开跑了但一直没结束，去 Render 看日志」：**不点名是哪个客户的什么东西丢了，
 *    也不说下一步是补跑**，混在 170 条里没人看得出这是一次客户交付损失。
 *    所以这里要解决的不是「没人报」，是「报得没法用」。
 *
 *    怎么认出这类死法（**这条判据比日志好用，日志会滚掉**）：开跑那行走的是建表 DDL 的
 *    `NOW()` 默认值 —— **微秒精度（6 位小数）**；`finish()` 传的是 JS 的
 *    `toISOString()` —— **毫秒精度（3 位小数）**，upsert 会把 `started_at` 一起盖掉。
 *    所以 `started_at` 还是 6 位小数 = 收尾代码一次都没跑过（进程被杀），3 位 = 跑过。
 *
 *    修法分两层，**兜底的是第二层，第一层只是锦上添花**：
 *
 *    ① `closeInFlightCronRuns()` —— 容器被换掉之前 Render 先发 SIGTERM，赶在被杀前把
 *       本进程还没收尾的记录写成 `failed`。它能给出「**是被部署掐的**」这个原因，清扫给不出。
 *       但它**不保证跑得到**：Next 的 `next start` 收到 SIGTERM 走 `server.close(() => exit(0))`，
 *       回调在连接清空那一刻触发，而 `process.exit` 不等 pending 的 promise。
 *       连接还开着（blog-weekly 那种开跑 98 秒被换机）→ 写得进去；连接已经被 Cloudflare
 *       在 125 秒时 524 掐掉（attribution-cron 那种跑 500 秒的）→ 可能当场就退了。
 *       信号本身穿得过 `npm start` 那层（实测 npm 11.19 会转发给子进程，子进程的异步收尾也跑完了；
 *       Render 上是 Node 24.14.1，同为 npm 11.x）。
 *
 *    ② `reapAbandonedCronRuns()` —— **这条才是保证**。不依赖进程还活着：任何停在 `running`、
 *       开跑超过 `ABANDONED_AFTER_MS` 的行，一律收成 `failed`。SIGKILL / OOM / 进程直接崩，
 *       SIGTERM 一个都兜不住，这条都兜得住。挂在 `cron-run-logs-cleanup` 里每天跑一次。
 *
 *    两层都写同一个 `summary.interrupted_by` 标记（取值不同），今日待办那条按标记出人工任务
 *    （见 `src/lib/pm-todo/manual-items.ts` 的 `pushInterruptedCronRunItems`）。
 *
 * 写日志本身失败**不抛异常**：它是观测手段，不是安全闸，不该把正在跑的业务任务弄挂。
 */

export interface CronRunHandle {
  finish(opts: {
    processed?: number
    completed?: number
    failed?: number
    summary?: Record<string, unknown>
    error?: string
  }): Promise<void>
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
 * 这次运行是被部署换机（或任何 SIGTERM）掐断的 —— 写进 `summary` 的标记键。
 *
 * 为什么是 `summary` 里的标记、而不是新开一个 `status='interrupted'`：
 * `cron_run_logs.status` 上有 CHECK 约束，只认 running / completed / failed，
 * 加第四种值要改库。而「被掐断」本来就是一种失败，`failed` 是对的终态；
 * 需要区分的地方（今日待办要说人话、要跟真正的业务报错分开）读这个标记就够了。
 */
export const INTERRUPTED_BY_KEY = 'interrupted_by'

/** `summary.interrupted_by` 的取值：进程收到关机信号时这一轮还没收尾（多半是部署换机）。 */
export const INTERRUPTED_BY_DEPLOY = 'deploy_shutdown'

/**
 * `summary.interrupted_by` 的取值：**不知道它怎么没的**，只知道开跑很久了还停在 `running`。
 *
 * SIGKILL / OOM / 进程直接崩，都不会留下 SIGTERM 那一手，只能靠事后清扫认出来。
 * 跟 `deploy_shutdown` 分开取值，是因为下一步动作一样（补跑），但**能不能说出原因**不一样 ——
 * 对 PM 说「有人上线把机器换了」和「它没了，原因不明」是两句不同的话，不能混成一句。
 */
export const INTERRUPTED_BY_PROCESS_GONE = 'process_gone'

/**
 * 停在 `running` 多久之后就认定「它已经没了」。
 *
 * 🔴 这个数不能拍脑袋：实测（近 14 天跑完的运行）HTTP 定时任务里最长的是
 *    `ai-tracker-weekly`，一轮 6093 秒 ≈ 1.7 小时。取 6 小时 ≈ 3.5 倍余量 ——
 *    收早了会把**正在好好跑**的一轮判成失败，那比漏报更糟（误报成常态之后，真出事那天
 *    也会被当噪音划掉，这是本文件头一段的教训）。
 */
export const ABANDONED_AFTER_MS = 6 * 60 * 60 * 1000

/**
 * 本进程里**开了跑、还没收尾**的运行记录。收到 SIGTERM 时靠它知道该收哪几行。
 *
 * 🔴 只登记 `startCronRun()`（HTTP 路由那条路），不登记 `startCronRunId()`（Inngest 那条路）。
 *    Inngest 的步骤可能落在任意一台实例上：这台收到 SIGTERM 时，那一轮说不定正在
 *    另一台上好好跑着，按本进程的记忆去收就是误伤。
 *
 *    ⚠️ 不代表 Inngest 那边没问题。实测 9 月停在 `running` 的 98 行里，最大头正是 Inngest 的
 *    `messenger-brief-hourly`（59 行，9/7 起每小时一条），说明那边的 `onFailure`
 *    → `failOpenCronRuns()` **实际上没有在收口**。那是另一条线的事（有独立窗口在修），
 *    本模块不认领；但 `reapAbandonedCronRuns()` 同样不去碰 Inngest 的任务，
 *    免得跟那边的收口互相打架 —— 它们的一轮可以合法地跑很久。
 */
const inFlight = new Map<string, { jobName: string; startedAt: number }>()

let shutdownHookInstalled = false

/**
 * 装一次进程级的 SIGTERM / SIGINT 收口 —— 幂等，第一个 `startCronRun()` 触发。
 *
 * 为什么不放 `instrumentation.ts`：那需要开 Next 的 experimental 开关、影响每一次构建，
 * 而这件事只跟「本进程有没有正在跑的定时任务」有关，状态就在这个模块里。
 *
 * 为什么来得及写库：Next 的 `next start` 收到 SIGTERM 走的是 `server.close(() => exit)`，
 * 它要等在途连接自己结束才退出，**不是同步 `process.exit()`**；Node 又会把同一个信号的
 * 所有监听器都调一遍。所以这里的异步写库有 Render 那 ~30 秒宽限期可用，够写一行。
 */
function installShutdownHook(): void {
  if (shutdownHookInstalled) return
  shutdownHookInstalled = true
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      // 必须接住：supabase 客户端万一是**抛**而不是返 error，这里没人接就是一个
      // unhandledRejection —— 而 Next 给 unhandledRejection 装的处理器只会打印，
      // 关机路径上的一次静默失败正是本文件在防的东西。
      closeInFlightCronRuns(signal).catch((err) => {
        console.error(`[cron-run-logger] ${signal} 收口整体抛异常：${err instanceof Error ? err.message : String(err)}`)
      })
    })
  }
}

/**
 * 把本进程里还没收尾的运行记录收成 `failed`，并标上「是被掐断的」。
 *
 * 🔴 用**带条件的 update**（`status='running'`）而不是 `finish()` 的 upsert：
 *    万一这一行其实已经在别处收成 `completed` 了（或者这个登记是残留），
 *    条件不满足就什么都不改 —— 宁可漏记一次，也不能把一次成功的运行写成失败。
 *    代价是「开跑那行压根没插进去」的情况这里补不回来，那种情况 `startCronRunId`
 *    已经 console.error 过了。
 *
 * 返回真正改到的行数。写失败不抛异常，理由同本文件其余部分。
 */
export async function closeInFlightCronRuns(signal: string): Promise<number> {
  const runs = [...inFlight.entries()]
  if (runs.length === 0) return 0
  inFlight.clear()

  const finishedAt = new Date().toISOString()
  let closed = 0

  for (const [runId, { jobName, startedAt }] of runs) {
    // 🔴 登记表里躺太久的那些**不能说成「被部署掐的」**。路由如果没有 try/catch，
    //    业务函数一抛异常 `finish()` 就永远不跑，条目会一直留到下一次部署 ——
    //    那时按 deploy_shutdown 收口就是**编造原因**：真实死因是那次异常。
    //    编出来的原因会让 PM 照着去补跑，下一轮同样抛异常，他还会再收到一条。
    const ageMs = Date.now() - startedAt
    const abandoned = ageMs > ABANDONED_AFTER_MS
    const { data, error } = await supabaseAdmin
      .from('cron_run_logs')
      .update({
        status: 'failed',
        finished_at: finishedAt,
        duration_ms: ageMs,
        error_message: abandoned
          ? `开跑后一直没收尾，进程关闭（${signal}）时一并收口 —— 死因不明，不要当成「被部署掐的」`
          : `跑到一半被掐断（${signal}）—— 多半是一次部署把这台机器换掉了，这一轮没跑完`,
        summary: {
          [INTERRUPTED_BY_KEY]: abandoned ? INTERRUPTED_BY_PROCESS_GONE : INTERRUPTED_BY_DEPLOY,
          signal,
        },
      })
      .eq('id', runId)
      .eq('status', 'running')
      .select('id')

    if (error) {
      console.error(
        `[cron-run-logger] ${jobName}: 被 ${signal} 掐断后收口失败（id=${runId}）—— 这次运行会永远停在 running。${describe(error)}`,
      )
      continue
    }
    if (data?.length) {
      closed += data.length
      console.error(
        `[cron-run-logger] ${jobName}: 收到 ${signal}，这一轮没跑完就被掐断了（id=${runId}），已记成 failed。`,
      )
      // 主动报 /fail，别等 healthchecks.io 那边「到点没人报到」才响 —— 那要多等一个宽限期。
      await pingHealthcheck(jobName, true)
    }
  }

  return closed
}

/**
 * 事后清扫：把停在 `running` 太久的运行收成 `failed`。**这条是「断了必定有人知道」的保证。**
 *
 * 🔴 为什么不能只靠 SIGTERM 收口：SIGKILL、OOM、进程直接崩，一个信号都不会有；
 *    就算有 SIGTERM，Next 的 `server.close(() => process.exit(0))` 也可能在异步写库
 *    落地之前就退了（整段推理见本文件头）。判据不该建在「进程还活着」上面 ——
 *    这次事故的本质恰恰是**进程不在了**。
 *
 * 🔴 跳过 Inngest 调度的任务：它们的一轮可以合法地跑很久（实测 `messenger-brief-hourly`
 *    有跑完用时 95494 秒的记录），按 6 小时去收就是误伤；那边另有 `onFailure` 这条路。
 *
 * 写失败不抛异常，理由同本文件其余部分。返回收掉的行数。
 */
export async function reapAbandonedCronRuns(now: Date = new Date()): Promise<number> {
  const httpJobs = CRON_REGISTRY
    .filter((e) => (e.scheduler ?? 'render') !== 'inngest')
    .map((e) => e.jobName)
  if (httpJobs.length === 0) return 0

  const cutoff = new Date(now.getTime() - ABANDONED_AFTER_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .update({
      status: 'failed',
      finished_at: now.toISOString(),
      error_message: `开跑超过 ${Math.round(ABANDONED_AFTER_MS / 3_600_000)} 小时还停在「在跑」—— 进程多半已经没了（部署换机 / 被杀 / 崩了），这一轮没跑完`,
      summary: { [INTERRUPTED_BY_KEY]: INTERRUPTED_BY_PROCESS_GONE },
    })
    .in('job_name', httpJobs)
    .eq('status', 'running')
    .is('finished_at', null)
    .lt('started_at', cutoff)
    .select('id, job_name')

  if (error) {
    console.error(
      `[cron-run-logger] 清扫停在 running 的旧运行失败 —— 这些行会继续挂着，今日待办里只会看到泛泛的「卡死」。${describe(error)}`,
    )
    return 0
  }

  const reaped = data ?? []
  if (reaped.length > 0) {
    console.error(
      `[cron-run-logger] 清扫掉 ${reaped.length} 条停在 running 的旧运行：${[...new Set(reaped.map((r) => r.job_name))].join('、')}`,
    )
  }
  return reaped.length
}

/** 只给测试用：清掉登记表，避免用例之间互相串味。 */
export function __resetInFlightForTests(): void {
  inFlight.clear()
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
  // 登记 + 装收口钩子：从这一刻起，这台机器被换掉的话这一行不会再无声地停在 running。
  inFlight.set(runId, { jobName, startedAt })
  installShutdownHook()
  return finisher(jobName, runId, startedAt)
}

function finisher(jobName: string, runId: string, startedAt: number): CronRunHandle {
  const startedAtIso = new Date(startedAt).toISOString()

  return {
    async finish({ processed = 0, completed = 0, failed = 0, summary, error: jobError }) {
      const durationMs = Date.now() - startedAt
      const outcome = {
        id: runId,
        job_name: jobName,
        started_at: startedAtIso,
        status: jobError ? 'failed' : 'completed',
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
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
      const { error: upsertError } = await supabaseAdmin
        .from('cron_run_logs')
        .upsert(outcome, { onConflict: 'id' })

      // 🔴 摘在 upsert **之后**，不是之前。摘在前面的话，「已摘除、但 upsert 还没落库」
      //    这个窗口里被杀，这一行就回到「永远停在 running」—— 正是要修的那个病。
      //    摘在后面最坏是收口先写了 failed、upsert 再盖成 completed，结果依然正确
      //    （反过来不成立：upsert 之后到达的收口会被 `.eq('status','running')` 挡住）。
      inFlight.delete(runId)

      if (upsertError) {
        console.error(
          `[cron-run-logger] ${jobName}: 收尾写不进 cron_run_logs（id=${runId}）—— 这次运行可能永远停在 running，或者彻底没有痕迹。${describe(upsertError)}`,
        )
      }

      await pingHealthcheck(jobName, Boolean(jobError))
    },
  }
}

/**
 * 跑完了往 healthchecks.io 报个到 —— 只对在清单里填了 `healthcheckUuid` 的任务生效。
 *
 * 🔴 为什么由服务端报、而不是 render.yaml 里那条 `&& curl hc-ping.com/...`：
 *    源站前面挂着 Cloudflare，响应超过约 125 秒就 524 断连，cron 容器那条 curl 于是
 *    退出码非 0、`&&` 短路，上报一次都发不出去 —— 而服务端每一轮都跑完了。
 *    退出码回答的是「网关有没有等到响应」，不是「这件活儿干完没有」。整段实测见
 *    `src/lib/cron/registry.ts` 的 `healthcheckUuid` 注释。
 *
 * 上报失败只记日志、绝不抛：它是观测手段，不能把已经跑完的任务反过来弄成失败。
 */
async function pingHealthcheck(jobName: string, failed: boolean): Promise<void> {
  const uuid = CRON_REGISTRY.find((e) => e.jobName === jobName)?.healthcheckUuid
  if (!uuid) return
  const url = `https://hc-ping.com/${uuid}${failed ? '/fail' : ''}`
  try {
    await fetch(url, { signal: AbortSignal.timeout(10_000) })
  } catch (err) {
    console.error(
      `[cron-run-logger] ${jobName}: healthchecks.io 上报失败（这一轮的结果不受影响）: ${err instanceof Error ? err.message : String(err)}`,
    )
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
