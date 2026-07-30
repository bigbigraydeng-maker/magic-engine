// OpenAI gpt-image-1 — synchronous image generation
// Returns base64 PNG immediately; no job polling needed.

import { getOpenAIClient } from '@/lib/ai/openai-client'

type ImageSize = '1024x1024' | '1536x1024' | '1024x1536'

const ASPECT_RATIO_MAP: Record<string, ImageSize> = {
  '1:1':  '1024x1024',
  '4:5':  '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
}

export async function generateImage(params: {
  prompt: string
  aspect_ratio?: string
}): Promise<{ b64: string; size: ImageSize }> {
  const { prompt, aspect_ratio = '1:1' } = params
  const size = ASPECT_RATIO_MAP[aspect_ratio] ?? '1024x1024'

  const client = getOpenAIClient()

  const response = await client.images.generate({
    model: 'gpt-image-1',
    prompt,
    n: 1,
    size,
  })

  const b64 = response.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image data')

  return { b64, size }
}

/**
 * 图改图(image-to-image)—— 抓来的素材必经这一步才能进成片。
 *
 * 为什么必须有:抓来的图是**别人的作品**,直接放进客户广告是版权风险。
 * 经 gpt-image-1 重绘后是**衍生创作**:同一场景、同一构图,但像素全部重新生成。
 * 2026-07-26 实测(张家界那张):照片 → 金色油画质感,场景保留、画风完全重绘。
 *
 * 这也是「抓图 → AI 改图 → 图转视频」这条链的中间环节 —— 此前完全缺失,
 * 导致抓来的图要么原样用(有版权风险)要么根本用不上。
 *
 * 注意:`images.edit` 需要 File/Blob,Node 侧用 toFile 包装 Buffer。
 */
export async function transformImage(params: {
  /** 源图字节(抓来的原图) */
  image: Buffer
  /** 改图指令:描述要保留什么、改成什么风格 */
  prompt: string
  aspect_ratio?: string
  /** 源图文件名(决定 mime 推断,必须带正确后缀) */
  filename?: string
}): Promise<{ b64: string; size: ImageSize }> {
  const { image, prompt, aspect_ratio = '9:16', filename = 'source.jpg' } = params
  const size = ASPECT_RATIO_MAP[aspect_ratio] ?? '1024x1536'

  const { toFile } = await import('openai')
  const client = getOpenAIClient()

  // 必须显式给 type:只传文件名时 SDK 会发 application/octet-stream,
  // OpenAI 直接 400「unsupported mimetype」(2026-07-26 实测踩到)。
  const ext = filename.toLowerCase().split('.').pop() ?? 'jpg'
  const mime =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

  const response = await client.images.edit({
    model: 'gpt-image-1',
    image: await toFile(image, filename, { type: mime }),
    prompt,
    n: 1,
    size,
  })

  const b64 = response.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image data (edit)')

  return { b64, size }
}
