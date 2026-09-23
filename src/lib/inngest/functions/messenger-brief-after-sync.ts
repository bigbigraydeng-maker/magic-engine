/**
 * Magic Engine 2.0 · Inngest 云端消费者：私信同步跑完 → 写客户需求卡
 *
 * 一个函数，收一张「同步跑完了」的条子，把原来挤在一个 HTTP 请求里的一整轮拆成
 * 若干段来跑。事故与判据的来龙去脉写在 `@/lib/messenger/sync-completed-event`。
 *
 * 🔴 **为什么必须分段跑**：网关在**约 125 秒**掐断连接（501 条运行记录实测出来的边界）。
 *    原来一整轮 160~210 秒，永远踩过这条线；Inngest 这边每一段都是一个独立请求，
 *    段内约 40 秒，远在线内。失败也只重试那一段 —— 已经写好的卡不会被重写，
 *    既省钱也不会把销售看过的卡换掉。
 *
 * 🔴 **每一处副作用都必须在 `step.run` 里。** Inngest 在每个 step 边界之后会把函数体
 *    从头重放一遍（step 结果走缓存，step **外**的代码每遍都真跑）。运行记录写在 step
 *    外的话，一轮会插出好几行 `cron_run_logs`，其中大部分永远停在「在跑」——
 *    而这条链路的全部立论就是「那些记录是真的」。
 *
 * 🔴 **`now` 必须在第一个 step 里取一次然后传下去**，不能每段各自 `new Date()`：
 *    「安静了 30 分钟才写卡」和「每天最多重写 3 次」两条闸都按 `now` 判，
 *    每段各取各的会让同一轮里前后几段用不同的今天。
 *
 * 🔴 **一事件一主**：`me/messenger.sync.completed` 是云端专属事件，本机 factory-worker
 *    不监听（见 client.ts 的 WORKER_OWNED_EVENTS，契约测试锁死）。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import {
  BRIEFS_PER_CHUNK,
  chunkDueBriefs,
  generateDueBriefs,
  loadDueBriefs,
  runPostBriefSweeps,
  type DueBrief,
  type PostBriefSweepResult,
} from '@/lib/messenger/brief-cycle'
import {
  MESSENGER_BRIEF_JOB,
  MESSENGER_SYNC_COMPLETED_EVENT,
  parseSyncCompleted,
} from '@/lib/messenger/sync-completed-event'

/** 这一轮的回执 —— Inngest 后台里能直接看懂的那份。 */
export interface BriefCycleReceipt {
  readonly job: string
  readonly status: 'written' | 'nothing_due' | 'load_failed' | 'invalid_payload' | 'aborted'
  readonly candidates: number
  readonly generated: number
  readonly failed: number
  readonly chunks: number
  readonly error: string | null
  readonly created_at: string
}

/** 依赖注入版：便于直接注入假的挑人 / 假的写卡，不碰真模型、不花钱。 */
export function createMessengerBriefAfterSyncFunction(deps: {
  loadDue: (now: Date) => Promise<DueBrief[]>
  generate: (
    due: readonly DueBrief[],
    now: Date,
  ) => Promise<{ generated: number; failed: number; aborted?: string | null }>
  sweeps: (now: Date) => Promise<PostBriefSweepResult>
}) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}messenger-brief-after-sync`,
      name: 'Messenger brief: write cards after the hourly sync finishes',
      // 🔴 同一时间只跑一轮。两轮并行会各自挑出**同一批**候选（挑人和写卡之间有间隔），
      //    然后把同一批卡各写一遍 —— 钱花两份，销售看到的卡还会来回换。
      concurrency: { limit: 1 },
      /**
       * 🔴 **必须 > 0**（子牙复审 2026-09-07 揪出来的，第一版写的 0 是抄错了）。
       *
       * `retries` 是「**这个函数所有 step 的最大重试次数**」（inngest 3.54.0
       * `InngestFunction.d.ts`：maximum number of retries for all steps across this
       * function，默认 3）。写 0 = 任何一段抛错整条 run 立刻判死，后面的段全不跑：
       *   · `write-briefs-2` 挂 → 第 3、4 段不跑 → `post-brief-sweeps` 不跑
       *   · 最要命的是 `log-finish` 自己也零重试 —— 它就是一次 Supabase update，
       *     网络抖一下抛错，那行 `cron_run_logs` 就**永远停在「在跑」**。
       *     而这条链路的全部立论就是「那些运行记录是真的」。
       *
       * 「重试会重复花钱」这个担心不成立：每段是独立 memoized step，重试时函数
       * 从头重放、已成功的段走缓存，只有挂掉那一段真的重跑。最坏是那一段里已写完的
       * ≤12 张卡被重写一次，而 `shouldGenerateBrief` 的「每条对话每天最多重写 3 次」
       * 是兜底闸，不会失控。
       *
       * 取 2 跟同仓样板一致：`flywheel-seo-weekly.ts` 里**多段编排**的派单函数用 2，
       * 只有**单段干活**（钱在那一步里花掉、重试等于再付一次）的 worker 才用 0。
       * 第一版把 worker 的值抄到了编排函数上。
       */
      retries: 2,
      /**
       * 🔴 **重试耗尽后仍失败，必须把那行运行记录收成 `failed`。**
       *
       * 2026-09-23 事故的「看不见」那一半就死在这里：原来没配 `onFailure`，
       * 于是一段被网关掐断 → 重试也被掐断 → 整条 run 判死 → `log-finish` 一次都没跑到
       * → `cron_run_logs` 那行永远停在 `running`，而健康检查的 `failing` 只认
       * `status='failed'`，`stuck` 又只看最新一条（每小时任务的最新一条永远不满一小时）。
       * 结果：链路停产 3 天，体检报告上全绿，累计 50 行假的「在跑」。
       *
       * 收口本身早就有现成的（`failOpenCronRuns`，conversion-daily-pipeline 在用），
       * 这个函数只是一直没接上。
       */
      onFailure: async ({ event, error }) => {
        const message =
          error?.message ||
          (event.data as { error?: { message?: string } } | undefined)?.error?.message ||
          '未知错误'
        // 失败事件自带发生时刻（EventPayload.ts；FailureEventPayload 的类型没把它露出来）。
        const ts = (event as { ts?: number }).ts
        const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
        await failOpenCronRuns(MESSENGER_BRIEF_JOB, `重试耗尽后仍失败：${message}`, { startedBefore })
      },
    },
    { event: MESSENGER_SYNC_COMPLETED_EVENT },
    async ({ event, step }): Promise<BriefCycleReceipt> => {
      const parsed = parseSyncCompleted(event.data)

      const started = await step.run('log-start', async () => ({
        runId: await startCronRunId(MESSENGER_BRIEF_JOB),
        startedAt: Date.now(),
        nowIso: new Date().toISOString(),
      }))
      const run = cronRunHandle(MESSENGER_BRIEF_JOB, started.runId, started.startedAt)
      const now = new Date(started.nowIso)
      const base = { job: MESSENGER_BRIEF_JOB, created_at: started.nowIso }

      if (!parsed.ok) {
        await step.run('log-finish-invalid', async () => {
          await run.finish({ failed: 1, error: `条子读不懂：${parsed.reason}` })
          return null
        })
        return { ...base, status: 'invalid_payload', candidates: 0, generated: 0, failed: 0, chunks: 0, error: parsed.reason }
      }

      // 挑人：纯读库，不花钱。读失败要如实报 —— 报成「今天没人要写卡」会把
      // 一次读库故障伪装成一轮正常的空转，正是这次事故的形态。
      const due = await step.run('load-due', async () => {
        try {
          return { ok: true as const, list: await deps.loadDue(now) }
        } catch (err) {
          return { ok: false as const, reason: err instanceof Error ? err.message : String(err) }
        }
      })

      if (!due.ok) {
        await step.run('log-finish-load-failed', async () => {
          await run.finish({ failed: 1, error: due.reason })
          return null
        })
        return { ...base, status: 'load_failed', candidates: 0, generated: 0, failed: 0, chunks: 0, error: due.reason }
      }

      const chunks = chunkDueBriefs(due.list, BRIEFS_PER_CHUNK)
      let generated = 0
      let failed = 0
      /**
       * 🔴 某一段自己主动停下来（余额用光 / 时间预算用完）就**别再排下一段**。
       *    余额用光时后面每一段都会同样失败，而每一段都要先烧掉 20 秒 × 12 条才知道 ——
       *    这就是 2026-09-23 那次「段永远不返回」的来源。
       */
      let aborted: string | null = null
      for (const [i, chunk] of chunks.entries()) {
        const r = await step.run(`write-briefs-${i}`, async () => deps.generate(chunk, now))
        generated += r.generated
        failed += r.failed
        if (r.aborted) {
          aborted = r.aborted
          break
        }
      }

      // 主动停下来的那一轮：如实记成失败就收工。
      //
      // 🔴 不重试、不抛异常。余额用光重试一百次也不会好（`fatalAiReason` 的判据），
      //    时间预算用完更不该在同一轮里接着跑 —— 该做的是让这行运行记录带着真实原因
      //    变成 `failed`，让体检报告红灯、待办里出现一条人能动手的事。
      //    积压会顺着后面几轮慢慢排掉（每轮 50 张的闸照旧生效）。
      if (aborted) {
        await step.run('log-finish-aborted', async () => {
          await run.finish({
            processed: due.list.length,
            completed: generated,
            failed,
            error: aborted ?? '未知原因',
            summary: {
              candidates: due.list.length,
              generated,
              failed,
              chunks: chunks.length,
              chunkSize: BRIEFS_PER_CHUNK,
              aborted,
              triggeredBy: MESSENGER_SYNC_COMPLETED_EVENT,
              syncReceipt: parsed.value,
              // 扫尾两遍这一轮故意没跑 —— 它们要读刚写好的卡，而这一轮没写完。
              sweepsSkipped: true,
            },
          })
          return null
        })
        return {
          ...base,
          status: 'aborted',
          candidates: due.list.length,
          generated,
          failed,
          chunks: chunks.length,
          error: aborted,
        }
      }

      // 写完卡之后的两遍扫描。要读刚写好的卡，所以排在最后。
      const sweeps = await step.run('post-brief-sweeps', async () => deps.sweeps(now))

      await step.run('log-finish', async () => {
        await run.finish({
          processed: due.list.length,
          completed: generated,
          failed,
          summary: {
            candidates: due.list.length,
            generated,
            failed,
            chunks: chunks.length,
            chunkSize: BRIEFS_PER_CHUNK,
            triggeredBy: MESSENGER_SYNC_COMPLETED_EVENT,
            syncReceipt: parsed.value,
            ...sweeps,
          },
        })
        return null
      })

      return {
        ...base,
        status: due.list.length === 0 ? 'nothing_due' : 'written',
        candidates: due.list.length,
        generated,
        failed,
        chunks: chunks.length,
        error: null,
      }
    },
  )
}

/** 生产实例。 */
export const messengerBriefAfterSync = createMessengerBriefAfterSyncFunction({
  loadDue: (now) => loadDueBriefs(now),
  generate: (due, now) => generateDueBriefs(due, now),
  sweeps: (now) => runPostBriefSweeps(now),
})
