/**
 * GET/PATCH /api/clients/[id]/ad-strategy-config
 *
 * Reads and updates a client's Ad Strategy Engine control settings (on/off,
 * digest recipients). Backs the Settings panel (P21.K.5). Config edits go
 * through this route — never raw SQL — per the FDE-config red-line.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadAdStrategyConfig } from '@/lib/ads-strategy/config'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const config = await loadAdStrategyConfig(clientId)
  return NextResponse.json({ success: true, config })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { enabled?: unknown; digest_recipients?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = { client_id: clientId, updated_at: new Date().toISOString() }

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }
    update.enabled = body.enabled
  }

  if (body.digest_recipients !== undefined) {
    if (!Array.isArray(body.digest_recipients) || body.digest_recipients.some(e => typeof e !== 'string')) {
      return NextResponse.json({ error: 'digest_recipients must be an array of strings' }, { status: 400 })
    }
    const emails = (body.digest_recipients as string[]).map(e => e.trim()).filter(Boolean)
    const bad = emails.find(e => !EMAIL_RE.test(e))
    if (bad) return NextResponse.json({ error: `Invalid email: ${bad}` }, { status: 400 })
    update.digest_recipients = emails
  }

  const { error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .upsert(update, { onConflict: 'client_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const config = await loadAdStrategyConfig(clientId)
  return NextResponse.json({ success: true, config })
}
