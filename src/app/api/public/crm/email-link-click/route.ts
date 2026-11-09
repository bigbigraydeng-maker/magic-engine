/**
 * POST /api/public/crm/email-link-click — a client's own website reports that someone opened a tracked mail link.
 * Design: docs/specs/2026-11-10-crm-email-click-tracking-b2-design-v0.md §4.4.
 *
 * Public and unauthenticated on purpose: the 12-character token in the link is the only credential, and only the mail's
 * recipient has it. The worst a holder can do is add clicks to their own record. So:
 *  - the body is at most 1KB and is parsed strictly; a malformed token is refused before any database read;
 *  - an unknown token, a token whose mail was not sent, and every other "no" all answer 204: callers learn nothing;
 *  - there is no per-IP limit (every report comes from the website's own server), only a whole-endpoint cap per minute;
 *  - this route never tells the website to retry, and never fails its page: the site does not wait for us.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readBoundedJson } from '@/lib/http/bounded-body'
import { createClickStore } from '@/lib/crm/email-templates/link-tracking/click-store-prod'
import { createMinuteCap, parseClickReport, recordClick } from '@/lib/crm/email-templates/link-tracking/record-click'
import { createMailNewStore } from '@/lib/microsoft/mail-send-new-prod'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 1024
const overCap = createMinuteCap(600)

const noContent = (): NextResponse => new NextResponse(null, { status: 204 })

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (overCap(Date.now())) return new NextResponse(null, { status: 429 })
  const body = await readBoundedJson(req, MAX_BODY_BYTES)
  if (!body.ok) return new NextResponse(null, { status: body.reason === 'too_large' ? 413 : 400 })
  const value = body.value
  const parsed = parseClickReport(value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
  if (!parsed.ok) return new NextResponse(null, { status: 400 })
  try {
    await recordClick(parsed.report, createClickStore(supabaseAdmin, createMailNewStore()), new Date())
  } catch (err) {
    console.error('[link-click] 记录点击失败:', err instanceof Error ? err.message : err)
  }
  return noContent()
}
