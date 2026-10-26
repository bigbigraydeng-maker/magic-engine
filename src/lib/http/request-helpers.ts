/**
 * Shared server-side request helpers used by API route handlers: a size-capped JSON body reader
 * and a uuid check for path parameters (design §6.10.1 item 7). Server-side only.
 */

import { NextResponse } from 'next/server'

/** Edit, member, settings and publish-request bodies are small; anything larger is refused unread. */
export const MAX_EDIT_BODY_BYTES = 64 * 1024

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function invalidIdResponse(): NextResponse {
  return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
}

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse }

/** Read the body as text first so the size cap applies before any parsing. */
export async function readJsonBody(
  req: Request,
  maxBytes: number = MAX_EDIT_BODY_BYTES,
): Promise<JsonBodyResult> {
  let text: string
  try {
    text = await req.text()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return { ok: false, response: NextResponse.json({ error: 'request_too_large' }, { status: 413 }) }
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  }
}

export function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}
