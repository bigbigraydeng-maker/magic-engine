// MiniMax 配音（走 Muapi）— 用客户在 MiniMax 上的克隆声音把中文稿转成语音。
// 中文母语引擎，取代 ElevenLabs（中文差，已弃用）。见 memory: video-factory-audio-viral-wiring。
// 大瑞的克隆声音 voice_id = 'bigrayvoice01'（已过 PM）。

import { runMuapi } from '@/lib/muapi/client'
import { supabaseAdmin } from '@/lib/supabase'

const TTS_MODEL = 'minimax-speech-2.6-hd'
const VOICE_BUCKET = 'content-factory'

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
  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`Failed to fetch VO audio from Muapi: ${res.status}`)

  const bytes = new Uint8Array(await res.arrayBuffer())
  const fileSizeKb = Math.round(bytes.length / 1024)
  const path = `${clientId}/${folder ?? 'voiceovers'}/vo-${Date.now()}.mp3`

  const { error } = await supabaseAdmin.storage
    .from(VOICE_BUCKET)
    .upload(path, bytes, { contentType: 'audio/mpeg', upsert: true })
  if (error) throw error

  const { data } = supabaseAdmin.storage.from(VOICE_BUCKET).getPublicUrl(path)
  return { publicUrl: data.publicUrl, fileSizeKb }
}
