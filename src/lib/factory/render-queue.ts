// 🔴 已退役(2026-09-02，render.yaml 同一条注释)：这条旧 ffmpeg 拼片管线的排队入口，
// 已没有 worker 在消费。留仓库不删，不要当活代码维护——出片现在走 Creatomate 链
// (scene-assets.ts，走 content_factory_render_jobs 同一张表但 render_engine='creatomate')。
//
// 做片任务队列 — 流水线入口。确认选题时建一条做片任务(排队)，后台 worker 领着做。
// content_factory_render_jobs: queued→planning→rendering→assembling→ready_for_review / failed

import { supabaseAdmin } from '@/lib/supabase'

export interface EnqueueResult {
  jobId: string | null
  created: boolean
  reason?: string
}

/** 给一条已确认的选题建做片任务。已有未失败的任务则不重复建(幂等)。 */
export async function enqueueRenderJob(params: {
  clientId: string
  contentPostId: string
}): Promise<EnqueueResult> {
  const { clientId, contentPostId } = params

  const { data: existing } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id')
    .eq('content_post_id', contentPostId)
    .neq('status', 'failed')
    .limit(1)

  if (existing && existing.length > 0) {
    return { jobId: existing[0].id as string, created: false, reason: 'already queued' }
  }

  const { data, error } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .insert({ client_id: clientId, content_post_id: contentPostId, status: 'queued' })
    .select('id')
    .single()

  if (error) throw error
  return { jobId: data.id as string, created: true }
}
