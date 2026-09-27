// Shared HTTP plumbing for the two public website-check endpoints: CORS for the official site only,
// uniform error bodies, a size-capped JSON body read, and the fail-closed quota step.

import { NextRequest, NextResponse } from 'next/server'
import { QuotaUnavailable, consumeQuota, isAllowedOrigin } from './guards'

const MAX_BODY_BYTES = 16_384

export function corsHeaders(origin: string | null): Record<string, string> {
  if (isAllowedOrigin(origin)) {
    return {
      'Access-Control-Allow-Origin': origin as string,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    }
  }
  return { Vary: 'Origin' }
}

export function json(status: number, payload: unknown, origin: string | null): NextResponse {
  return NextResponse.json(payload, { status, headers: corsHeaders(origin) })
}

export function fail(status: number, code: string, origin: string | null): NextResponse {
  return json(status, { error: code, code }, origin)
}

export function preflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

/** Parse a small JSON object body; null for anything oversized, malformed or not an object. */
export async function readSmallJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length') || '0')
  if (declared > MAX_BODY_BYTES) return null
  const raw = await req.text().catch(() => '')
  if (!raw || raw.length > MAX_BODY_BYTES) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export interface QuotaStep {
  bucket: string
  key: string
  windowStart: string
  cap: number
  /** Error code the visitor sees when this cap is reached. */
  code: string
}

/** Consume each quota in order; the first refusal (or any store error) ends the request. */
export async function consumeSteps(steps: QuotaStep[], origin: string | null): Promise<NextResponse | null> {
  for (const step of steps) {
    try {
      if (!(await consumeQuota(step.bucket, step.key, step.windowStart, step.cap))) return fail(429, step.code, origin)
    } catch (err) {
      if (err instanceof QuotaUnavailable) return fail(503, 'unavailable', origin)
      throw err
    }
  }
  return null
}
