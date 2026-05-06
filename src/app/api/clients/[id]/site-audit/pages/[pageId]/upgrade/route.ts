import { NextRequest, NextResponse } from 'next/server'
import { upgradePage } from '@/lib/strategy/page-upgrader'

/**
 * POST /api/clients/[id]/site-audit/pages/[pageId]/upgrade
 *
 * Generates an upgrade recommendation for an existing site page.
 * Returns structured JSON; does NOT publish — the team applies
 * changes manually via the client CMS.
 *
 * Reference: ROADMAP.md P8.D.2.2
 */
export const maxDuration = 120

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; pageId: string } }
) {
  try {
    const recommendation = await upgradePage(params.id, params.pageId)
    return NextResponse.json({ success: true, recommendation })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = /not found|does not belong/i.test(message) ? 404 : 500
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
