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

/** 做片流水线还没结束的状态 —— 这些状态下不该被"满意去发布"之类的动作抢跑。 */
export const ACTIVE_JOB_STATUSES = ['queued', 'planning', 'rendering', 'assembling'] as const

/**
 * 这条内容是不是正在被流水线做片(排队中/进行中，还没到 ready_for_review/failed)。
 * video/route.ts 和 [postId]/route.ts 共用同一份判断 —— 原来各写一份，容易漏改一处。
 */
export async function hasActiveRenderJob(postId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id')
    .eq('content_post_id', postId)
    .in('status', ACTIVE_JOB_STATUSES)
    .limit(1)
  // 🔴 查询出错不能当成"没有活跃任务"(Codex 复审)：查询抖一下被误判成 false，
  // 后面的挂片/清片/发布这些写操作就会在渲染其实还在跑的时候照常放行——
  // 该拦的场景全部失守。查询失败就该让调用方的写操作跟着失败，不能悄悄放行。
  if (error) throw error
  return Boolean(data?.length)
}

export type ScheduleBlockedReason = 'not_found' | 'active_render_job'

export interface ScheduleResult {
  ok: boolean
  post?: { id: string; status: string; format: string | null }
  blockedReason?: ScheduleBlockedReason
}

/**
 * 「满意·去发布」的原子写。跟 hasActiveRenderJob+直接 update 的旧路径不同——那是
 * 「查一次再写」，两步之间有窗口，另一个标签页在窗口期建一次做片任务就会被漏过。
 * 这里改叫 factory_schedule_content_post RPC，检查活跃任务 + 写 scheduled 状态
 * 焊在同一条 Postgres UPDATE 语句里，物理上不存在中间窗口。见对应 migration。
 */
export async function scheduleContentPostAtomic(params: {
  clientId: string
  postId: string
}): Promise<ScheduleResult> {
  const { clientId, postId } = params
  const { data, error } = await supabaseAdmin.rpc('factory_schedule_content_post', {
    p_client_id: clientId,
    p_post_id: postId,
  })
  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('factory_schedule_content_post 没有返回任何行')

  if (row.ok) {
    return { ok: true, post: { id: row.post_id, status: row.status, format: row.format } }
  }
  return { ok: false, blockedReason: row.blocked_reason as ScheduleBlockedReason }
}
