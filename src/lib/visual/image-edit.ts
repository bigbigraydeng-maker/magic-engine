/**
 * Image-edit adapter for posters — one billed call, never a second one.
 *
 * Photo URL → bytes → OpenAI image edit → JPEG stored in our own bucket. Every edit is
 * billed, so the SDK's automatic retries are switched off and any failure (fetch, provider
 * error, empty output, storage) is returned as-is for the receipt; the caller falls back
 * to the original photo. Side effects are injected so tests never reach the network.
 *
 * 2026-11-15 PM「生成图片都转用 openai image 接口」: replaced the previous async
 * submit-and-poll provider, whose output misspelt poster text in 3 of 5 live runs.
 */
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { uploadFromBase64 } from '@/lib/visual/storage'

export interface ImageEditRequest {
  model: string
  imageUrl: string
  prompt: string
  /** Owner of the stored output (bucket path). */
  clientId: string
}

export type ImageEditResult =
  | { ok: true; outputUrl: string; fileSizeKb: number; costUsd: number | null; requestId: string | null }
  | { ok: false; reason: string; costUsd: number | null; requestId: string | null }

export interface ImageEditUsage {
  input_tokens_details?: { image_tokens?: number; text_tokens?: number }
  output_tokens?: number
}

export interface ImageEditDeps {
  fetchSource: (url: string) => Promise<{ bytes: Buffer; mimeType: string }>
  edit: (params: { model: string; image: Buffer; mimeType: string; prompt: string }) => Promise<{
    b64: string | null
    usage: ImageEditUsage | null
    requestId: string | null
  }>
  store: (params: { base64: string; clientId: string }) => Promise<{ storage_url: string; file_size_kb: number }>
}

/** USD per 1M tokens, from the provider's model page (read 2026-11-15). Unknown model → cost unknown. */
const PRICES_PER_M: Readonly<Record<string, { imageIn: number; textIn: number; out: number }>> = {
  'gpt-image-2.6-flare': { imageIn: 8, textIn: 5, out: 30 },
}

const EDIT_TIMEOUT_MS = 180_000
const FETCH_TIMEOUT_MS = 30_000

function short(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200)
}

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

export function imageEditCostUsd(model: string, usage: ImageEditUsage | null): number | null {
  const price = PRICES_PER_M[model]
  if (!price || !usage) return null
  const d = usage.input_tokens_details ?? {}
  const usd = (n(d.image_tokens) * price.imageIn + n(d.text_tokens) * price.textIn + n(usage.output_tokens) * price.out) / 1_000_000
  return Math.round(usd * 1_000_000) / 1_000_000
}

export const defaultImageEditDeps: ImageEditDeps = {
  fetchSource: async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const mimeType = type === 'image/png' || type === 'image/webp' ? type : 'image/jpeg'
    return { bytes: Buffer.from(await res.arrayBuffer()), mimeType }
  },
  edit: async ({ model, image, mimeType, prompt }) => {
    const { toFile } = await import('openai')
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
    const client = getOpenAIClient()
    const { data, request_id } = await client.images
      .edit(
        {
          model,
          image: await toFile(image, `photo.${ext}`, { type: mimeType }),
          prompt,
          n: 1,
          size: 'auto',
          quality: 'high',
          output_format: 'jpeg',
        },
        // A retry is a second billed edit.
        { maxRetries: 0, timeout: EDIT_TIMEOUT_MS },
      )
      .withResponse()
    return {
      b64: data.data?.[0]?.b64_json ?? null,
      usage: (data.usage as ImageEditUsage | undefined) ?? null,
      requestId: request_id ?? null,
    }
  },
  store: ({ base64, clientId }) =>
    uploadFromBase64({ base64, clientId, assetType: 'image', folder: 'posters', mimeType: 'image/jpeg' }),
}

export async function runImageEdit(
  req: ImageEditRequest,
  deps: ImageEditDeps = defaultImageEditDeps,
): Promise<ImageEditResult> {
  let source: { bytes: Buffer; mimeType: string }
  try {
    source = await deps.fetchSource(req.imageUrl)
  } catch (e) {
    return { ok: false, reason: `source_fetch_failed: ${short(e)}`, costUsd: null, requestId: null }
  }

  let out: Awaited<ReturnType<ImageEditDeps['edit']>>
  try {
    out = await deps.edit({ model: req.model, image: source.bytes, mimeType: source.mimeType, prompt: req.prompt })
  } catch (e) {
    // May or may not have been billed; never re-submit.
    return { ok: false, reason: `edit_failed: ${short(e)}`, costUsd: null, requestId: null }
  }

  const costUsd = imageEditCostUsd(req.model, out.usage)
  if (!out.b64) return { ok: false, reason: 'no_output', costUsd, requestId: out.requestId }

  try {
    const stored = await deps.store({ base64: out.b64, clientId: req.clientId })
    return { ok: true, outputUrl: stored.storage_url, fileSizeKb: stored.file_size_kb, costUsd, requestId: out.requestId }
  } catch (e) {
    return { ok: false, reason: `output_store_failed: ${short(e)}`, costUsd, requestId: out.requestId }
  }
}
