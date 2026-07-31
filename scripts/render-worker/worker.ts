// 做片后台 worker — 常驻轮询 content_factory_render_jobs，领排队任务→编排→拼接。
// 跑在 Render 独立容器(node + python-PIL + ffmpeg)。用 tsx 运行以复用 src/lib 的 TS 模块。
// 起：tsx scripts/render-worker/worker.ts

import { supabaseAdmin } from '@/lib/supabase'
import { runRenderGeneration } from '@/lib/factory/render-pipeline'
import { assembleRenderJob } from '@/lib/factory/render-assemble'

const POLL_MS = Number(process.env.RENDER_WORKER_POLL_MS || '20000')
const STALE_MIN = Number(process.env.RENDER_WORKER_STALE_MIN || '45')

function log(...a: unknown[]) {
  console.log(new Date().toISOString(), '[render-worker]', ...a)
}

/** 卡死回收：进程崩/重启/超时会把任务永久留在中间态，没人再碰。超时的标 failed，防死锁。 */
async function reapStale(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MIN * 60_000).toISOString()
  const { data } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .update({ status: 'failed', error: `卡死回收：超过 ${STALE_MIN} 分钟无进展`, updated_at: new Date().toISOString() })
    .in('status', ['planning', 'rendering', 'assembling'])
    .lt('updated_at', cutoff)
    .select('id')
  if (data && data.length) log('回收卡死任务', data.length, '条')
}

/** 领一条排队任务：先读最老的 queued，再用 status 守卫抢占，防多 worker 双领。 */
async function claimNext(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
  const id = data?.[0]?.id as string | undefined
  if (!id) return null

  const { data: claimed } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .update({ status: 'planning', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'queued') // 只有仍是 queued 才抢得到
    .select('id')
  return claimed && claimed.length ? id : null
}

async function processOne(jobId: string): Promise<void> {
  log('领到任务', jobId, '→ 生成画面+配音')
  await runRenderGeneration(jobId)   // → assembling
  log(jobId, '→ 拼接')
  await assembleRenderJob(jobId)     // → ready_for_review
  log(jobId, '✅ 成片，待审')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  log('启动，轮询间隔', POLL_MS, 'ms')
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await reapStale()
      const id = await claimNext()
      if (id) {
        try {
          await processOne(id)
        } catch (e) {
          // 单条任务失败已在 pipeline 内标 failed + 记 error，这里只记日志不退出
          log('任务失败', id, e instanceof Error ? e.message : e)
        }
        continue // 立刻查下一条
      }
    } catch (e) {
      log('轮询出错', e instanceof Error ? e.message : e)
    }
    await sleep(POLL_MS)
  }
}

main().catch((e) => {
  log('worker 崩溃', e)
  process.exit(1)
})
