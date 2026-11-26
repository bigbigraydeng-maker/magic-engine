/**
 * GET /api/clients/[id]/social-readback
 *
 * Read-only post-publish engagement (Story / image post / Reel) for one client.
 * Global administrators only; same gate as social-overview.
 */
import { NextResponse } from 'next/server'

import { createLiteServicePorts } from '@/lib/social/story-lite/ports'
import { resolveLiteClientActor } from '@/lib/social/story-lite/route-support'
import { requireGlobalAdmin } from '@/lib/social/story-lite/service'
import { internalError } from '@/lib/social/story-publish/route-support'
import {
  defaultReadbackWindow,
  loadSocialReadbackPanel,
} from '@/lib/social/social-readback-load'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function parseOptionalIso(value: string | null): Date | null {
  if (value === null || value.length === 0) return null
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return null
  return new Date(t)
}

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const resolved = await resolveLiteClientActor(params.id)
  if (!resolved.ok) return resolved.response

  const ports = createLiteServicePorts()
  const admin = requireGlobalAdmin(ports, resolved.actor)
  if (!admin.ok) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status })
  }

  const url = new URL(req.url)
  const now = new Date()
  const defaultWindow = defaultReadbackWindow(now)
  const since = parseOptionalIso(url.searchParams.get('since')) ?? defaultWindow.since
  const until = parseOptionalIso(url.searchParams.get('until')) ?? defaultWindow.until
  if (since.getTime() > until.getTime()) {
    return NextResponse.json({ success: false, error: 'INVALID_WINDOW' }, { status: 400 })
  }

  const limitRaw = url.searchParams.get('limit')
  const limitParsed = limitRaw !== null ? Number(limitRaw) : 20
  const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? Math.min(limitParsed, 50) : 20

  try {
    const panel = await loadSocialReadbackPanel(supabaseAdmin, {
      clientId: params.id,
      since,
      until,
      limit,
      now,
    })
    return NextResponse.json({ success: true, panel })
  } catch (error: unknown) {
    console.error('[social-readback] failed', error instanceof Error ? error.message : 'unknown')
    return internalError()
  }
}
