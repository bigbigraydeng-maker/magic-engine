// 单讲数据层 — 讲课式内容存取都走这里，别处不许直接拼 snapshot。
// content_posts.generation_context_snapshot 结构(讲课式)：
//   lecture: LectureScript            结构化脚本(唯一真相源；script 列只是它拼出来的只读投影)
//   lecture_prev: LectureScript       上一版脚本(重生成时自动备份，可人工回滚)
//   lecture_production: {             制作方式与录像
//     method: 'self_record' | 'digital_human'
//     recording_url?, recording_uploaded_at?
//   }
//   lesson_no: number                 第几讲(课程区排序用)

import { supabaseAdmin } from '@/lib/supabase'
import type { LectureScript } from './lecture-script'

export type LectureMethod = 'self_record' | 'digital_human'

export interface LectureProduction {
  method: LectureMethod
  recording_url?: string
  recording_uploaded_at?: string
  changed_at?: string        // 最后一次改制作方式/换录像的时间(用来判断旧报错是否过期)
}

interface LectureSnapshot {
  lecture?: LectureScript
  lecture_prev?: LectureScript
  lecture_production?: LectureProduction
  lesson_no?: number
  [k: string]: unknown
}

export interface LecturePostRow {
  id: string
  client_id: string
  title: string
  status: string
  platforms: string[] | null
  source: string | null
  source_video_url: string | null
  format: string | null
  generation_context_snapshot: LectureSnapshot | null
}

/** 把结构化脚本拼成完整口播逐字稿(script 列的投影，看板全文用)。 */
export function spokenScriptOf(lecture: LectureScript): string {
  return [
    lecture.hookSpoken,
    ...lecture.sections.map((s) => s.spoken),
    lecture.ctaSpoken,
  ]
    .filter((s) => s && s.trim())
    .join('\n\n')
}

/** 读一条讲课式内容(带类型的 snapshot)。找不到或不是讲课式 → null。 */
export async function loadLecturePost(
  clientId: string,
  postId: string,
): Promise<{ post: LecturePostRow; lecture: LectureScript; production: LectureProduction | null; lessonNo: number | null } | null> {
  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .select('id, client_id, title, status, platforms, source, source_video_url, format, generation_context_snapshot')
    .eq('client_id', clientId)
    .eq('id', postId)
    .single()
  if (error || !data) return null

  const post = data as LecturePostRow
  const snap = post.generation_context_snapshot
  const lecture = snap?.lecture
  if (post.format !== '讲课式' || !lecture) return null

  return {
    post,
    lecture,
    production: snap?.lecture_production ?? null,
    lessonNo: typeof snap?.lesson_no === 'number' ? snap.lesson_no : null,
  }
}

/** 合并写 snapshot 的某几个键(读-改-写；单讲编辑是单人低频操作，不做乐观锁)。 */
async function patchSnapshot(
  clientId: string,
  postId: string,
  patch: Partial<LectureSnapshot>,
  extraColumns: Record<string, unknown> = {},
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .select('generation_context_snapshot')
    .eq('client_id', clientId)
    .eq('id', postId)
    .single()
  if (error || !data) throw new Error('未找到该内容')

  const snap = { ...((data.generation_context_snapshot as LectureSnapshot | null) ?? {}), ...patch }
  const { error: uErr } = await supabaseAdmin
    .from('content_posts')
    .update({ generation_context_snapshot: snap, ...extraColumns })
    .eq('client_id', clientId)
    .eq('id', postId)
  if (uErr) throw uErr
}

/**
 * 保存脚本(整篇)。backupPrev=true 时把当前版存进 lecture_prev(重生成场景)；
 * 人工小改(save_script)不备份，避免一次次点保存把 prev 冲掉。
 */
export async function saveLectureScript(params: {
  clientId: string
  postId: string
  lecture: LectureScript
  backupPrev?: boolean
}): Promise<void> {
  const { clientId, postId, lecture, backupPrev } = params
  const patch: Partial<LectureSnapshot> = { lecture }
  if (backupPrev) {
    const current = await loadLecturePost(clientId, postId)
    if (current) patch.lecture_prev = current.lecture
  }
  await patchSnapshot(clientId, postId, patch, {
    script: spokenScriptOf(lecture),
    caption: lecture.hookSpoken,
  })
}

/** 记录制作方式(自己录 / 数字人)；上传完录像时带 recordingUrl。 */
export async function setLectureProduction(params: {
  clientId: string
  postId: string
  method: LectureMethod
  recordingUrl?: string
}): Promise<void> {
  const { clientId, postId, method, recordingUrl } = params
  const current = await loadLecturePost(clientId, postId)
  const prev = current?.production
  const production: LectureProduction = {
    ...(prev && prev.method === method ? prev : { method }),
    method,
    // 改过制作方式/换过录像之后，之前那次失败的报错就过期了(不该再挂在屏幕上吓人)
    changed_at: new Date().toISOString(),
    ...(recordingUrl
      ? { recording_url: recordingUrl, recording_uploaded_at: new Date().toISOString() }
      : {}),
  }
  await patchSnapshot(clientId, postId, { lecture_production: production })
}
