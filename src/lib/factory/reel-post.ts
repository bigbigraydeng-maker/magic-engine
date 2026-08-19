// 边走边录自动剪辑的数据层 — 跟 lecture-post.ts 同一个模式，字段名对应但不共用
// (讲课式的 loadLecturePost 认 format='讲课式'，这条线的内容 format 是 null，
// 混在一起读会读错东西)。
//
// content_posts.generation_context_snapshot 结构(这条线新增的键)：
//   raw_recording_url: string          原始录像(粘的链接) —— 成片做完也不删，
//                                       支持「校对字幕后重做片」要重新下载原片
//   reel_transcript: ReelTranscript    Whisper 听写留档(段级+字级)，同一条录像不用重新听写
//   reel_captions: CaptionLine[]       当前生效的字幕(客户校准过就是校准版，否则是听写原文)

import { supabaseAdmin } from '@/lib/supabase'
import { extractTermEdits, loadLecturePrefs, mergeGlossary, saveLecturePrefs } from './lecture-learning'

export interface CaptionLine {
  start: number
  end: number
  text: string
}

export interface ReelTranscript {
  recordingUrl: string
  segments: { start: number; end: number; text: string }[]
  words: { start: number; end: number; word: string }[]
  savedAt: string
}

interface ReelSnapshot {
  raw_recording_url?: string
  reel_transcript?: ReelTranscript
  reel_captions?: CaptionLine[]
  [key: string]: unknown
}

async function patchSnapshot(
  clientId: string,
  postId: string,
  patch: Partial<ReelSnapshot>,
  opts: { requireApproved?: boolean } = {},
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .select('generation_context_snapshot')
    .eq('client_id', clientId)
    .eq('id', postId)
    .single()
  if (error || !data) throw new Error('未找到该内容')

  const snap = { ...((data.generation_context_snapshot as ReelSnapshot | null) ?? {}), ...patch }

  if (opts.requireApproved) {
    // 🔴 route.ts 调用前查过一次 post.status==='approved'，但那是先读后判，不是原子
    // 条件(Codex 复审)——查完到这次真正写库之间还有一小段间隙，内容完全可能在这
    // 几十毫秒里被另一个请求排期/发布。跟 stageRawRecording/clearVideo 同一条防线：
    // status 条件必须并进这次 update 本身，查完命中几行才算数，不能只在调用前查一次。
    const { data: updated, error: uErr } = await supabaseAdmin
      .from('content_posts')
      .update({ generation_context_snapshot: snap })
      .eq('client_id', clientId)
      .eq('id', postId)
      .eq('status', 'approved')
      .select('id')
    if (uErr) throw uErr
    if (!updated?.length) throw new Error('这条内容的状态已经变了（可能已排期或已发布）— 刷新页面再看一下')
    return
  }

  const { error: uErr } = await supabaseAdmin
    .from('content_posts')
    .update({ generation_context_snapshot: snap })
    .eq('client_id', clientId)
    .eq('id', postId)
  if (uErr) throw uErr
}

/**
 * 读一条边走边录内容的字幕相关状态。真的没这条内容 → null。
 *
 * 🔴 查询出错(网络抖一下)不能跟"没这条内容"混为一谈(Codex 复审)：reel-render.ts
 * 重做片时靠这个函数判断要不要复用已存的听写/客户校对过的字幕，返回 null 会让它
 * 当成"从没做过"重新听写、拿机器字幕把客户校对过的结果覆盖掉——查询抖一下就把
 * 客户的校对工作冲掉，等数据库恢复了也回不来了。
 */
export async function loadReelCaptionState(
  clientId: string,
  postId: string,
): Promise<{ rawRecordingUrl: string | null; transcript: ReelTranscript | null; captions: CaptionLine[] | null } | null> {
  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .select('generation_context_snapshot')
    .eq('client_id', clientId)
    .eq('id', postId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const snap = (data.generation_context_snapshot as ReelSnapshot | null) ?? {}
  return {
    rawRecordingUrl: snap.raw_recording_url ?? null,
    transcript: snap.reel_transcript ?? null,
    captions: snap.reel_captions ?? null,
  }
}

/** 做片时留档听写结果和当前字幕，供下次复用/客户校对。 */
export async function saveReelTranscriptAndCaptions(params: {
  clientId: string
  postId: string
  transcript: ReelTranscript
  captions: CaptionLine[]
}): Promise<void> {
  const { clientId, postId, transcript, captions } = params
  await patchSnapshot(clientId, postId, { reel_transcript: transcript, reel_captions: captions })
}

/**
 * 客户在页面上改完字幕:只收文字，时间沿用原来的(改时间容易和口型对不上)。
 * 跟讲课式 saveCaptions 同一逻辑，包括「从校对里学术语」——两条线共用同一份
 * 客户词表(loadLecturePrefs 是按 clientId 存的，不分讲课式/边走边录，同一个客户
 * 的说话习惯本来就是同一套)。
 */
export async function saveReelCaptions(params: {
  clientId: string
  postId: string
  texts: string[]
}): Promise<{ saved: number }> {
  const { clientId, postId, texts } = params
  const state = await loadReelCaptionState(clientId, postId)
  if (!state) throw new Error('未找到该内容')
  const existing = state.captions
  if (!existing || existing.length === 0) throw new Error('还没有字幕可改 — 先做一次自动剪辑')
  if (texts.length !== existing.length) throw new Error('字幕条数对不上，请刷新页面重试')

  // 🔴 不许 filter 掉空字符串 —— reel-render.ts 重做片时要求校对字幕条数跟新切出来
  // 的字幕条数完全相等，条数一变整批校对会被判定"对不上"而整体作废(连带没清空的
  // 那些也一起被冲回听写原文)。空字符串就留着空文本，渲染时那条不画字幕就是了，
  // 不能靠"数组变短"来表示"删掉这条"。
  const merged = existing.map((c, i) => ({ ...c, text: (texts[i] ?? '').trim() }))
  await patchSnapshot(clientId, postId, { reel_captions: merged }, { requireApproved: true })

  // 从这次校准里学术语，学错了会把客户改对的字又改回去，所以失败不影响保存
  try {
    const edits = extractTermEdits(existing.map((c) => c.text), merged.map((c) => c.text))
    if (edits.length > 0) {
      const prefs = await loadLecturePrefs(clientId)
      const glossary = mergeGlossary(prefs.glossary, edits, new Date().toISOString())
      await saveLecturePrefs(clientId, { glossary })
    }
  } catch {
    // 学习失败不该影响这次保存已经成功
  }

  return { saved: merged.length }
}
