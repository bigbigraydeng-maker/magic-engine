/**
 * POST /api/clients/[id]/cms/wordpress/... — wait, that's the page-rewriter.
 *
 * This is /api/clients/[id]/leads — the public lead-capture endpoint that
 * Stage-2 client landing pages POST to (the Oztop /quote/ LP is the first
 * consumer, see docs/mockups/oztop-quote-lp.html).
 *
 * Security model
 * --------------
 *   - PUBLIC, NO AUTH. Submitted from anonymous browsers on the client's
 *     own domain (oztopbuildingsupplies.com.au, etc).
 *   - CORS: allow the client's own domain (from clients.domain) and nothing
 *     else. Preflight handled by OPTIONS.
 *   - Honeypot field `company_hp` — bot submissions get 200 OK so the bot
 *     never learns the trap exists, but nothing is written to the DB.
 *   - Per-(client_id, IP) rate limit: 5 leads / 60 s. Hot prospects hitting
 *     refresh-spam are tolerated; bot floods get 429'd.
 *   - sanitizeLead enforces every field; UNTRUSTED INPUT is the default
 *     posture.
 *   - Service-role Supabase client (RLS bypassed at insert; the table is
 *     fronted by this route alone).
 *
 * Response shape
 * --------------
 *   200 OK            { success: true,  lead_id: string }
 *   200 OK (honeypot) { success: true,  lead_id: null   }   ← bot wears the trap
 *   400 Bad Request   { success: false, error,  code: 'INVALID_INPUT' }
 *   404 Not Found     { success: false, error,  code: 'CLIENT_NOT_FOUND' }
 *   429 Too Many      { success: false, error,  code: 'RATE_LIMITED' }
 *   500 Internal      { success: false, error,  code: 'INTERNAL' }
 *
 * Phase 12.R · lead-capture (Stage 2)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sanitizeLead, extractClientIp, type RawLeadInput } from '@/lib/leads/sanitize'

interface RouteContext {
  params: { id: string }
}

const RATE_LIMIT_PER_MIN = 5
const RATE_WINDOW_SEC    = 60

// ─── CORS helpers ─────────────────────────────────────────────────────────────

/**
 * Look up the client's primary domain and build an Origin allowlist.
 * Returns an empty array if the client doesn't exist — the caller treats
 * an empty allowlist as "no client" and refuses to set any CORS headers.
 */
async function resolveClientOrigins(clientId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('domain')
    .eq('id', clientId)
    .maybeSingle()
  if (!data || typeof data.domain !== 'string') return []
  const host = data.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase()
  if (!host) return []
  // Allow both apex and www subdomain — covers the most common pair without
  // opening the door to arbitrary subdomains.
  return [`https://${host}`, `https://www.${host}`]
}

function corsHeaders(allowOrigin: string | null): Record<string, string> {
  if (!allowOrigin) {
    return {
      Vary: 'Origin',
    }
  }
  return {
    'Access-Control-Allow-Origin':  allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '600',
    Vary:                           'Origin',
  }
}

function chooseAllowOrigin(reqOrigin: string | null, allowList: string[]): string | null {
  if (!reqOrigin) return null
  // Normalise BOTH sides and ECHO the normalised value — keeping the raw
  // (possibly attacker-cased) string in the response header is a footgun for
  // any future code that compares headers to the allowlist.
  const norm = reqOrigin.toLowerCase()
  return allowList.includes(norm) ? norm : null
}

function shape(body: Record<string, unknown>, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return NextResponse.json(body, {
    status:  init.status ?? 200,
    headers: init.headers,
  })
}

// ─── OPTIONS (CORS preflight) ─────────────────────────────────────────────────

export async function OPTIONS(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const reqOrigin = req.headers.get('origin')
  const allowList = await resolveClientOrigins(params.id)
  const allow     = chooseAllowOrigin(reqOrigin, allowList)
  return new NextResponse(null, { status: 204, headers: corsHeaders(allow) })
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    return await handlePost(req, ctx)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[leads POST]', ctx.params.id, msg)
    return shape(
      { success: false, error: 'Internal error processing lead submission', code: 'INTERNAL' },
      { status: 500 },
    )
  }
}

async function handlePost(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const clientId  = params.id
  const reqOrigin = req.headers.get('origin')
  const allowList = await resolveClientOrigins(clientId)
  if (allowList.length === 0) {
    return shape(
      { success: false, error: 'Client not found', code: 'CLIENT_NOT_FOUND' },
      { status: 404 },
    )
  }
  const allow = chooseAllowOrigin(reqOrigin, allowList)
  const headers = corsHeaders(allow)

  // Parse body
  let raw: RawLeadInput
  try {
    raw = await req.json() as RawLeadInput
  } catch {
    return shape(
      { success: false, error: 'Invalid JSON body', code: 'INVALID_INPUT' },
      { status: 400, headers },
    )
  }

  // We need a stable rate-limit key BEFORE doing anything that touches the
  // DB. Reject sources we cannot key — otherwise every XFF-less request gets
  // bucketed under the literal 'unknown' and a single attacker on a quirky
  // path can exhaust the bucket and starve real users (魏征 P0.3).
  const clientIp = extractClientIp(req.headers)
  if (clientIp === 'unknown') {
    return shape(
      {
        success: false,
        error:   'Source IP could not be determined — please submit through the live LP, not a server-side relay.',
        code:    'INVALID_INPUT',
      },
      { status: 400, headers },
    )
  }

  // Rate limit per (client_id, client_ip) over the last RATE_WINDOW_SEC.
  // Honeypot submissions ALSO consume the bucket so attackers can't use
  // honeypot field as a way to burst the endpoint (魏征 P0.2).
  const since = new Date(Date.now() - RATE_WINDOW_SEC * 1000).toISOString()
  const { count: recent, error: rateErr } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('client_ip', clientIp)
    .gte('created_at', since)

  if (rateErr) {
    // Fail OPEN — we'd rather accept a possible-spam lead than lose a real one.
    console.error('[leads POST] rate-limit count failed, failing open:', rateErr)
  } else if ((recent ?? 0) >= RATE_LIMIT_PER_MIN) {
    return shape(
      {
        success: false,
        error:   `Too many submissions — try again in a minute, or call the showroom.`,
        code:    'RATE_LIMITED',
      },
      { status: 429, headers },
    )
  }

  // Sanitize AFTER the rate-limit check so a bot-flood payload still gets
  // counted toward its IP's quota. (Sanitize is cheap; the order matters only
  // for the rate-limit guarantee.)
  const clean = sanitizeLead(raw)

  // Honeypot — quietly succeed, no DB insert. The bucket was already debited
  // by the rate-limit check above, so a determined spammer cannot use the
  // honeypot field as a way to bypass throttling.
  if (!clean.ok && clean.code === 'HONEYPOT') {
    return shape({ success: true, lead_id: null }, { headers })
  }
  if (!clean.ok) {
    return shape(
      { success: false, error: clean.reason, code: clean.code },
      { status: 400, headers },
    )
  }

  // Insert. Service-role bypasses RLS; no end-user identity to forward.
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('leads')
    .insert({
      client_id:    clientId,
      name:         clean.lead.name,
      phone:        clean.lead.phone,
      email:        clean.lead.email,
      project_type: clean.lead.project_type,
      suburb:       clean.lead.suburb,
      timeline:     clean.lead.timeline,
      message:      clean.lead.message,
      source_url:   clean.lead.source_url,
      referrer:     clean.lead.referrer,
      utm_source:   clean.lead.utm_source,
      utm_medium:   clean.lead.utm_medium,
      utm_campaign: clean.lead.utm_campaign,
      submitted_at: clean.lead.submitted_at,
      client_ip:    clientIp,
      user_agent:   req.headers.get('user-agent')?.slice(0, 500) ?? null,
    })
    .select('id')
    .single()

  if (insErr || !inserted) {
    console.error('[leads POST] insert failed:', insErr)
    return shape(
      { success: false, error: 'Could not save your enquiry — please call us.', code: 'INTERNAL' },
      { status: 500, headers },
    )
  }

  return shape({ success: true, lead_id: inserted.id }, { headers })
}
