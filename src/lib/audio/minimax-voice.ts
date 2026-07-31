// MiniMax 配音（走 Muapi）— 用客户在 MiniMax 上的克隆声音把中文稿转成语音。
// 中文母语引擎，取代 ElevenLabs（中文差，已弃用）。见 memory: video-factory-audio-viral-wiring。
// 大瑞的克隆声音 voice_id = 'bigrayvoice01'（已过 PM）。

import { randomUUID } from 'node:crypto'
import { runMuapi } from '@/lib/muapi/client'
import { supabaseAdmin } from '@/lib/supabase'

const TTS_MODEL = 'minimax-speech-2.6-hd'
const VOICE_BUCKET = 'content-factory'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface VoiceoverResult {
  audioUrl: string    // Supabase 公开 URL（永久，供拼片 worker 下载）
  sourceUrl: string   // Muapi 原始产物 URL（会过期）
  costUsd: number
  fileSizeKb: number
}

/**
 * 用客户的克隆声音把一段中文文本转成配音，落 Supabase 后返回永久 URL。
 * 时长由下游拼片（ffmpeg）自行测量，这里不返回。
 */
export async function generateVoiceover(params: {
  clientId: string
  text: string
  voiceId: string          // MiniMax voice_id，如 'bigrayvoice01'
  emotion?: string
  folder?: string          // 存储子目录，默认 voiceovers
}): Promise<VoiceoverResult> {
  const { clientId, text, voiceId, emotion, folder } = params
  if (!text.trim()) throw new Error('Voiceover text is empty')
  if (!voiceId.trim()) throw new Error('voiceId is required')
  // 租户隔离：clientId 必须是 UUID，杜绝空值前导斜杠 / `../` 写到别的目录
  if (!UUID_RE.test(clientId)) throw new Error(`Invalid clientId (must be UUID): ${clientId}`)

  const result = await runMuapi(TTS_MODEL, {
    prompt: text,
    voice_id: voiceId,
    language_boost: 'Chinese',
    ...(emotion ? { emotion } : {}),
  })

  const sourceUrl = result.outputs[0]
  if (result.status !== 'completed' || !sourceUrl) {
    throw new Error(`Voiceover generation failed: ${result.error ?? result.status}`)
  }

  const uploaded = await uploadAudio({ sourceUrl, clientId, folder })
  return {
    audioUrl: uploaded.publicUrl,
    sourceUrl,
    costUsd: result.costUsd ?? 0,
    fileSizeKb: uploaded.fileSizeKb,
  }
}

/** 把 Muapi 的临时 mp3 拉回来存进 Supabase 公开桶，返回永久 URL。 */
async function uploadAudio(params: {
  sourceUrl: string
  clientId: string
  folder?: string
}): Promise<{ publicUrl: string; fileSizeKb: number }> {
  const { sourceUrl, clientId, folder } = params
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`Failed to fetch VO audio from Muapi: ${res.status}`)

  const bytes = new Uint8Array(await res.arrayBuffer())
  // 空/垃圾产物别当成功——否则下游 ffmpeg 才神秘失败
  if (bytes.length === 0) throw new Error('Muapi returned empty audio (0 bytes)')
  const fileSizeKb = Math.round(bytes.length / 1024)
  // 唯一文件名：毫秒时间戳并发会撞、upsert 会静默互相覆盖，加 uuid 段根治
  const path = `${clientId}/${folder ?? 'voiceovers'}/vo-${Date.now()}-${randomUUID().slice(0, 8)}.mp3`

  const { error } = await supabaseAdmin.storage
    .from(VOICE_BUCKET)
    .upload(path, bytes, { contentType: 'audio/mpeg', upsert: true })
  if (error) throw error

  const { data } = supabaseAdmin.storage.from(VOICE_BUCKET).getPublicUrl(path)
  return { publicUrl: data.publicUrl, fileSizeKb }
}
