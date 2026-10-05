// Shared body-reading primitive for our own public-facing routes: reads a request body capped at
// `maxBytes` — streamed, so a missing or lying `Content-Length` never lets an oversized body through —
// then parses it as JSON. Never throws and picks no error-response convention of its own; callers
// (site-check's `readSmallJson`, the Meta AI surface's `boundedBody`) each keep their own shape and
// failure policy on top of this.
//
// Sunk down from two near-duplicate implementations (src/lib/tools-lab/site-check/http.ts and
// src/lib/meta/ai/http.ts) that differed only in their byte cap and how a failure was reported.

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'too_large' | 'empty' | 'invalid_json' }

export async function readBoundedJson(req: Request, maxBytes: number): Promise<BoundedJsonResult> {
  const declared = Number(req.headers.get('content-length') || '0')
  if (declared > maxBytes) return { ok: false, reason: 'too_large' }

  const reader = req.body?.getReader()
  if (!reader) return { ok: false, reason: 'empty' }

  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, reason: 'too_large' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }

  const raw = new TextDecoder().decode(Buffer.concat(chunks))
  if (!raw) return { ok: false, reason: 'empty' }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
}
