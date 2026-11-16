/**
 * POST /api/public/crm/site-callback-request — a client's own website passes on a guest's "please call me" request.
 * Design: docs/specs/2026-11-17-cts-online-brochure-tracking-v0.md §2.4 and §4 (slice 2); rules in
 * src/lib/crm/site-actions/callback-request.ts.
 *
 * Public and unauthenticated on purpose, like email-link-click: the 12-character mail-link token is the only
 * credential, and the worst a holder can do is ask for a call on that guest's own record. So:
 *  - the body is at most 2KB and is parsed strictly (fixed choices only); a malformed request is refused before any
 *    database read;
 *  - an unknown token, a mail that was not sent, a day out of range, a non-browser, too many requests, a repeat: all
 *    answer 204, so callers learn nothing about the token; only a failed read or write answers 503;
 *  - a whole-endpoint cap per minute, counted on well-formed requests only;
 *  - nothing here sends anything to anyone: it writes one row on the guest's record, which staff act on.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readBoundedJson } from '@/lib/http/bounded-body'
import { createMinuteCap } from '@/lib/crm/email-templates/link-tracking/record-click'
import { parseCallbackReport, recordCallbackRequest } from '@/lib/crm/site-actions/callback-request'
import { createCallbackStore } from '@/lib/crm/site-actions/callback-request-prod'
import { createMailNewStore } from '@/lib/microsoft/mail-send-new-prod'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 2048
const overCap = createMinuteCap(60)

const noContent = (): NextResponse => new NextResponse(null, { status: 204 })

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readBoundedJson(req, MAX_BODY_BYTES)
  if (!body.ok) return new NextResponse(null, { status: body.reason === 'too_large' ? 413 : 400 })
  const value = body.value
  const parsed = parseCallbackReport(value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
  if (!parsed.ok) return new NextResponse(null, { status: 400 })
  if (overCap(Date.now())) return new NextResponse(null, { status: 429 })
  try {
    await recordCallbackRequest(parsed.report, createCallbackStore(supabaseAdmin, createMailNewStore()), new Date())
  } catch (err) {
    // Unlike a click, a lost call-back request is a guest waiting for a call that never comes: say so, so the site can
    // show its phone number instead of "we'll call you". A read or write failure says nothing about the token.
    console.error('[site-callback] 记录回电请求失败:', err instanceof Error ? err.message : err)
    return new NextResponse(null, { status: 503 })
  }
  return noContent()
}
