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

/** 一条字幕(时间是成片里的时间，不是原始录像时间)。 */
export interface CaptionLine {
  start: number
  end: number
  text: string
}

/**
 * 听写结果留档 —— 存下来有两个用处：
 * ①客户能在页面上校准字幕(机器听写会有错字);②重做片不必再听写一次(省钱省时间)。
 * recordingUrl 用来判断录像有没有换过——换了就作废重听。
 */
export interface LectureTranscript {
  recordingUrl: string
  segments: { start: number; end: number; text: string }[]
  words: { start: number; end: number; word: string }[]
  savedAt: string
}

/** 某个教学要点配的录屏(讲到这段时上半屏放它，替掉课件)。键 = 要点序号(从 0 起)。 */
export interface SectionClip {
  url: string
  added_at: string
}

export interface LectureProduction {
  method: LectureMethod
  recording_url?: string
  recording_uploaded_at?: string
  changed_at?: string        // 最后一次改制作方式/换录像的时间(用来判断旧报错是否过期)
  section_clips?: Record<string, SectionClip>
  /** 片头再多剪几秒(自动判得不准时的手动微调，默认 0)。 */
  extra_head_trim_sec?: number
}

interface LectureSnapshot {
  lecture?: LectureScript
  lecture_prev?: LectureScript
  lecture_production?: LectureProduction
  lecture_transcript?: LectureTranscript
  /** 客户校准过的字幕(有就以它为准，时间不动、只改字)。 */
  lecture_captions?: CaptionLine[]
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
): Promise<{
  post: LecturePostRow
  lecture: LectureScript
  production: LectureProduction | null
  transcript: LectureTranscript | null
  captions: CaptionLine[] | null
  lessonNo: number | null
} | null> {
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
    transcript: snap?.lecture_transcript ?? null,
    captions: snap?.lecture_captions ?? null,
    lessonNo: typeof snap?.lesson_no === 'number' ? snap.lesson_no : null,
  }
}

/** 做片时把听写结果和最终字幕留档，供客户校准 / 下次重做片复用。 */
export async function saveTranscriptAndCaptions(params: {
  clientId: string
  postId: string
  transcript: LectureTranscript
  captions: CaptionLine[]
}): Promise<void> {
  const { clientId, postId, transcript, captions } = params
  await patchSnapshot(clientId, postId, {
    lecture_transcript: transcript,
    lecture_captions: captions,
  })
}

/** 客户在页面上改完字幕:只收文字，时间沿用原来的(改时间容易和口型对不上)。 */
export async function saveCaptions(params: {
  clientId: string
  postId: string
  texts: string[]
}): Promise<{ saved: number }> {
  const { clientId, postId, texts } = params
  const current = await loadLecturePost(clientId, postId)
  if (!current) throw new Error('未找到该讲')
  const existing = current.captions
  if (!existing || existing.length === 0) throw new Error('还没有字幕可改 — 先做一次片')
  if (texts.length !== existing.length) throw new Error('字幕条数对不上，请刷新页面重试')

  const merged = existing.map((c, i) => ({ ...c, text: (texts[i] ?? '').trim() }))
    .filter((c) => c.text)
  await patchSnapshot(clientId, postId, { lecture_captions: merged })
  return { saved: merged.length }
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

/**
 * 给某个教学要点配 / 取消录屏。制作方式保持不动(录屏是叠在课件位上的插入画面，
 * 跟「自己录还是数字人」是两件事)。
 */
export async function setSectionClip(params: {
  clientId: string
  postId: string
  index: number
  url: string | null          // null = 取消这一段的录屏
}): Promise<void> {
  const { clientId, postId, index, url } = params
  const current = await loadLecturePost(clientId, postId)
  if (!current) throw new Error('未找到该讲')
  if (!current.lecture.sections[index]) throw new Error('要点不存在')

  const prev = current.production
  const clips = { ...(prev?.section_clips ?? {}) }
  if (url) clips[String(index)] = { url, added_at: new Date().toISOString() }
  else delete clips[String(index)]

  const production: LectureProduction = {
    ...(prev ?? { method: 'self_record' }),
    section_clips: clips,
    changed_at: new Date().toISOString(),
  }
  await patchSnapshot(clientId, postId, { lecture_production: production })
}
