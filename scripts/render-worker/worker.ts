// 做片后台 worker — 常驻轮询 content_factory_render_jobs，领排队任务→编排→拼接。
// 跑在 Render 独立容器(node + python-PIL + ffmpeg)。用 tsx 运行以复用 src/lib 的 TS 模块。
// 起：tsx scripts/render-worker/worker.ts

import { supabaseAdmin } from '@/lib/supabase'
import { runRenderGeneration } from '@/lib/factory/render-pipeline'
import { assembleRenderJob } from '@/lib/factory/render-assemble'
import { runLectureRender } from '@/lib/factory/lecture-render'
import { runReelEditRender } from '@/lib/factory/reel-render'

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

/**
 * 三条管线分流：
 * - 讲课式(format='讲课式') → 上课件下真人
 * - 有暂存的原始录像(generation_context_snapshot.raw_recording_url) → 边走边录自动剪辑
 * - 其余 → 原 AI 生成画面 + b-roll 蒙太奇管线
 */
/**
 * 🔴 Codex 复审：两次查询查不到/查失败必须分开处理，不能都默认成 'ai_generated'——
 * 那条管线是真花钱的(AI 生成画面+配音)，DB 抖一下失败的任务被当成 AI 生成来跑，
 * 白烧外部 API 费用，还可能把跟原内容毫不相关的成片挂上去。查询出 error 时直接抛，
 * 让上层 catch 记日志、任务留在 planning，由 reapStale 兜底回收，不能悄悄默认分流。
 */
async function jobKind(jobId: string): Promise<'lecture' | 'reel_edit' | 'ai_generated'> {
  const { data: job, error: jobErr } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('content_post_id')
    .eq('id', jobId)
    .single()
  if (jobErr) throw new Error(`jobKind 查任务失败(${jobId}): ${jobErr.message}`)
  if (!job) return 'ai_generated' // 任务本身确实不存在(不是查询出错)，没有内容可分流，走原有兜底管线
  const { data: post, error: postErr } = await supabaseAdmin
    .from('content_posts')
    .select('format, generation_context_snapshot')
    .eq('id', job.content_post_id)
    .single()
  if (postErr) throw new Error(`jobKind 查内容失败(${job.content_post_id}): ${postErr.message}`)
  if (post?.format === '讲课式') return 'lecture'
  const snap = (post?.generation_context_snapshot as Record<string, unknown> | null) ?? {}
  if (snap.raw_recording_url) return 'reel_edit'
  return 'ai_generated'
}

async function processOne(jobId: string): Promise<void> {
  const kind = await jobKind(jobId)
  if (kind === 'lecture') {
    log('领到任务', jobId, '→ 讲课式(上课件下真人)')
    await runLectureRender(jobId)      // 全程到 ready_for_review
    log(jobId, '✅ 成片，待审')
    return
  }
  if (kind === 'reel_edit') {
    log('领到任务', jobId, '→ 边走边录自动剪辑(掐头去尾+字幕高亮)')
    await runReelEditRender(jobId)     // 全程到 ready_for_review
    log(jobId, '✅ 成片，待审')
    return
  }
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
