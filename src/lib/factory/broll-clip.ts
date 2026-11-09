// 画面 — 把一段分镜的画面描述变成一条竖屏 AI 空镜片：文字→图(gpt-image)→图生视频(Muapi i2v)→存库。
// 做片管道第 3 块。产出（clip URL）喂给拼片(ffmpeg)。
// 规矩：AI 视频只走 Muapi（见 memory: disable-higgsfield-use-muapi）；画面只做氛围空镜，不冒充客户真实产品。

import { generateImage } from '@/lib/visual/openai-images'
import { uploadFromBase64, uploadFromUrl } from '@/lib/visual/storage'
import { runMuapi } from '@/lib/muapi/client'

// 便宜快的图生视频档：图 + 运镜 → 6 秒竖屏 768P。
// 实测账单 $0.30/条（2026-09-03，8 条 = $2.40）；此前注释写的 ~$0.15 是错的。
const I2V_MODEL = 'minimax-hailuo-02-standard-i2v'
// i2v 含排队常 3-5 分钟，等待上限给足（拼片 worker 后台跑，不占普通请求）。
const I2V_TIMEOUT_MS = 600000

export interface ImageToClipResult {
  clipUrl: string      // 空镜视频（Supabase 永久 URL）
  costUsd: number
}

export interface BrollClipResult extends ImageToClipResult {
  imageUrl: string     // 首帧图（Supabase 永久 URL）
}

/**
 * 已有图片 + 运镜 → 竖屏 AI 空镜片（Muapi i2v），存永久 URL。
 *
 * imageUrl 必须是 Muapi 拉得到的公开地址。
 *
 * ⚠️ i2v 是**逐帧重画**，不是给真图加运镜：密集人脸 / 密集小字 / 复杂地标
 * 会被画糊或改写，换运镜提示词救不回来（2026-09-03 兵马俑两次实测均失败）。
 * 这类镜头改走真实像素运镜（Ken Burns），别用本函数。
 * 产出一律按 AI 生成标注，不得当客户真实产品发（见 memory:
 * feedback-real-vs-generated-clip-provenance）。
 */
export async function imageToClip(params: {
  clientId: string
  imageUrl: string
  motionPrompt: string
  folder?: string          // 存储子目录，默认 broll
  durationSec?: 6 | 10
}): Promise<ImageToClipResult> {
  const { clientId, imageUrl, motionPrompt, folder = 'broll', durationSec = 6 } = params
  if (!imageUrl.trim()) throw new Error('imageUrl is empty')

  const gen = await runMuapi(I2V_MODEL, {
    prompt: motionPrompt || 'slow, subtle natural motion',
    image_url: imageUrl,
    duration: durationSec,
    resolution: '768P',
  }, I2V_TIMEOUT_MS)
  const sourceClipUrl = gen.outputs[0]
  if (gen.status !== 'completed' || !sourceClipUrl) {
    throw new Error(`b-roll i2v failed: ${gen.error ?? gen.status}`)
  }

  // Muapi 产出是临时 URL（30 天过期），拉回来存永久地址供拼片下载。
  const clip = await uploadFromUrl({ sourceUrl: sourceClipUrl, clientId, assetType: 'video', folder })

  return { clipUrl: clip.storage_url, costUsd: gen.costUsd ?? 0 }
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

  // 2-3. 图 + 运镜 → 视频 → 存永久 URL（与直接喂现成图走同一条实现）
  const { clipUrl, costUsd } = await imageToClip({
    clientId,
    imageUrl: img.storage_url,
    motionPrompt,
    folder,
    durationSec,
  })

  return { imageUrl: img.storage_url, clipUrl, costUsd }
}
