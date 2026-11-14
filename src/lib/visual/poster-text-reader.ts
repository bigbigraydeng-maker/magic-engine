/**
 * Read back the text on a generated poster — transcription only.
 *
 * The model is told to copy every visible character as written and never to judge or
 * correct it; whether the text is right is decided by the pure `posterTextMatches`.
 *
 * The installed SDK (0.32.x) only types base64 image input, so the image is fetched
 * here and sent as base64. The SDK client is created inside the call (CLAUDE.md §7).
 */
import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_HAIKU, modelCostUsd } from '@/lib/anthropic/client'

export type PosterTextRead =
  | { ok: true; text: string; costUsd: number | null }
  | { ok: false; reason: string; costUsd: number | null }

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000

export const POSTER_TRANSCRIBE_PROMPT = [
  'Transcribe every piece of text visible in this image, exactly as written, character by character.',
  'One output line per line of text in the image, top to bottom.',
  'Keep the spelling, spacing and punctuation exactly as shown, even if it looks wrong.',
  'Do not correct, translate, explain, summarise or judge anything. Output only the transcription.',
].join('\n')

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

function mediaTypeOf(contentType: string | null): ImageMediaType {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('png')) return 'image/png'
  if (ct.includes('webp')) return 'image/webp'
  if (ct.includes('gif')) return 'image/gif'
  return 'image/jpeg'
}

function short(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200)
}

async function fetchImage(imageUrl: string): Promise<{ data: string; mediaType: ImageMediaType } | string> {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) return `image_fetch_${res.status}`
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length === 0) return 'image_empty'
  if (bytes.length > MAX_IMAGE_BYTES) return 'image_too_large'
  return { data: bytes.toString('base64'), mediaType: mediaTypeOf(res.headers.get('content-type')) }
}

export async function readPosterText(imageUrl: string): Promise<PosterTextRead> {
  let image: { data: string; mediaType: ImageMediaType } | string
  try {
    image = await fetchImage(imageUrl)
  } catch (e) {
    return { ok: false, reason: `image_fetch_failed: ${short(e)}`, costUsd: null }
  }
  if (typeof image === 'string') return { ok: false, reason: image, costUsd: null }

  try {
    const client = getAnthropicClient()
    const message = await client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 800,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
          { type: 'text', text: POSTER_TRANSCRIBE_PROMPT },
        ],
      }],
    })
    const costUsd = modelCostUsd(MODEL_HAIKU, message.usage.input_tokens, message.usage.output_tokens)
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (!text) return { ok: false, reason: 'empty_transcription', costUsd }
    return { ok: true, text, costUsd }
  } catch (e) {
    return { ok: false, reason: `transcribe_failed: ${short(e)}`, costUsd: null }
  }
}
