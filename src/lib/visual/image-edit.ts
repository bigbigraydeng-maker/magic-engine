/**
 * Image-edit adapter — one submit, one poll, never a second submit.
 *
 * Every submit is billed, so a failure (provider error, timeout, empty output)
 * is returned as-is with the request id for the receipt; the caller falls back.
 * The provider client is injected so tests never reach the network.
 */
import { pollMuapiResult, submitMuapi, type MuapiResult } from '@/lib/muapi/client'

export interface ImageEditRequest {
  model: string
  imageUrl: string
  prompt: string
  resolution: '2K'
  /** Poll deadline; default 240s. */
  timeoutMs?: number
}

export type ImageEditResult =
  | { ok: true; outputUrl: string; costUsd: number | null; requestId: string }
  | { ok: false; reason: string; costUsd: number | null; requestId: string | null }

export interface ImageEditDeps {
  submit: (model: string, input: Record<string, unknown>) => Promise<string>
  poll: (requestId: string, timeoutMs: number) => Promise<MuapiResult>
}

const DEFAULT_TIMEOUT_MS = 240_000

export const defaultImageEditDeps: ImageEditDeps = {
  submit: submitMuapi,
  poll: pollMuapiResult,
}

function short(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.slice(0, 200)
}

function cost(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export async function runImageEdit(
  req: ImageEditRequest,
  deps: ImageEditDeps = defaultImageEditDeps,
): Promise<ImageEditResult> {
  let requestId: string
  try {
    requestId = await deps.submit(req.model, {
      prompt: req.prompt,
      images_list: [req.imageUrl],
      resolution: req.resolution,
      output_format: 'jpg',
    })
  } catch (e) {
    return { ok: false, reason: `submit_failed: ${short(e)}`, costUsd: null, requestId: null }
  }

  let result: MuapiResult
  try {
    result = await deps.poll(requestId, req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  } catch (e) {
    // Timeout or repeated poll errors: the job may still be running on the provider side.
    // Do NOT re-submit — that would bill twice.
    return { ok: false, reason: `poll_failed: ${short(e)}`, costUsd: null, requestId }
  }

  const costUsd = cost(result.costUsd)
  if (result.status !== 'completed') {
    return { ok: false, reason: `job_${result.status}: ${result.error ?? ''}`.trim().slice(0, 200), costUsd, requestId }
  }
  const outputUrl = result.outputs.find((o) => /^https:\/\//i.test(o))
  if (!outputUrl) return { ok: false, reason: 'no_output', costUsd, requestId }
  return { ok: true, outputUrl, costUsd, requestId }
}
