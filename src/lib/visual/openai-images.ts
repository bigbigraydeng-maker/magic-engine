// OpenAI gpt-image-1 — synchronous image generation
// Returns base64 PNG immediately; no job polling needed.

import OpenAI from 'openai'

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

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const response = await client.images.generate({
    model: 'gpt-image-1',
    prompt,
    n: 1,
    size,
  })

  const b64 = response.data[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image data')

  return { b64, size }
}
