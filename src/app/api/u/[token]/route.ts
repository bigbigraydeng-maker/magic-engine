// The one-click unsubscribe entry of automated ME e-mails: /api/u/<token>. Public (no login).
// The logic is in @/lib/messaging/triggered-send/unsubscribe-entry; this file only wires it up.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  BUSY_PAGE,
  ENTRY_PAGE_HEADERS,
  TOO_LARGE_PAGE,
  clientKeyOf,
  createRateLimiter,
  handleUnsubscribeGet,
  handleUnsubscribePost,
  type EntryPage,
} from '@/lib/messaging/triggered-send/unsubscribe-entry'
import { createUnsubscribeEntryDeps } from '@/lib/messaging/triggered-send/unsubscribe-entry-prod'

export const dynamic = 'force-dynamic'

/** The one-click body is a few bytes and is never read; a large declared body is refused outright. */
const MAX_DECLARED_BODY = 8_192
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 })

function respond(result: EntryPage): NextResponse {
  return new NextResponse(result.html, { status: result.status, headers: ENTRY_PAGE_HEADERS })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  if (!limiter.allow(clientKeyOf(req.headers.get('x-forwarded-for')))) return respond({ status: 429, html: BUSY_PAGE })
  const { token } = await ctx.params
  return respond(handleUnsubscribeGet(token, createUnsubscribeEntryDeps(supabaseAdmin)))
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  if (!limiter.allow(clientKeyOf(req.headers.get('x-forwarded-for')))) return respond({ status: 429, html: BUSY_PAGE })
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_DECLARED_BODY) return respond({ status: 413, html: TOO_LARGE_PAGE })
  const { token } = await ctx.params
  return respond(await handleUnsubscribePost(token, createUnsubscribeEntryDeps(supabaseAdmin)))
}
