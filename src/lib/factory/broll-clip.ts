// 画面 — 把一段分镜的画面描述变成一条竖屏 AI 空镜片：文字→图(gpt-image)→图生视频(Muapi i2v)→存库。
// 做片管道第 3 块。产出（clip URL）喂给拼片(ffmpeg)。
// 规矩：AI 视频只走 Muapi（见 memory: disable-higgsfield-use-muapi）；画面只做氛围空镜，不冒充客户真实产品。

import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64, uploadFromUrl } from '@/lib/visual/storage'
import { runMuapi } from '@/lib/muapi/client'

// 便宜快的图生视频档：图 + 运镜 → 6 秒竖屏 768P。~$0.15/条。
const I2V_MODEL = 'minimax-hailuo-02-standard-i2v'
// i2v 含排队常 3-5 分钟，等待上限给足（拼片 worker 后台跑，不占普通请求）。
const I2V_TIMEOUT_MS = 600000

export interface BrollClipResult {
  imageUrl: string     // 首帧图（Supabase 永久 URL）
  clipUrl: string      // 空镜视频（Supabase 永久 URL）
  costUsd: number
}

/** 生成一条竖屏 AI 空镜片。imagePrompt=画面，motionPrompt=运镜（都来自分镜）。 */
export async function generateBrollClip(params: {
  clientId: string
  imagePrompt: string
  motionPrompt: string
  folder?: string          // 存储子目录，默认 broll
  durationSec?: 6 | 10
}): Promise<BrollClipResult> {
  const { clientId, imagePrompt, motionPrompt, folder = 'broll', durationSec = 6 } = params
  if (!imagePrompt.trim()) throw new Error('imagePrompt is empty')

  // 1. 文字 → 首帧图（竖屏 9:16）
  const { b64 } = await generateImage({ prompt: imagePrompt, aspect_ratio: '9:16' })
  const img = await uploadFromBase64({ base64: b64, clientId, assetType: 'image', folder })

  // 2. 图 + 运镜 → 图生视频（Muapi i2v）
  const gen = await runMuapi(I2V_MODEL, {
    prompt: motionPrompt || 'slow, subtle natural motion',
    image_url: img.storage_url,
    duration: durationSec,
    resolution: '768P',
  }, I2V_TIMEOUT_MS)
  const sourceClipUrl = gen.outputs[0]
  if (gen.status !== 'completed' || !sourceClipUrl) {
    throw new Error(`b-roll i2v failed: ${gen.error ?? gen.status}`)
  }

  // 3. 把 Muapi 临时视频拉回来存永久 URL（供拼片下载）
  const clip = await uploadFromUrl({ sourceUrl: sourceClipUrl, clientId, assetType: 'video', folder })

  return {
    imageUrl: img.storage_url,
    clipUrl: clip.storage_url,
    costUsd: gen.costUsd ?? 0,
  }
}
