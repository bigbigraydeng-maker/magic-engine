/**
 * GET /api/voice/health — liveness + readiness (spec §19).
 * ?check=ready verifies config + store selection without calling paid models.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getVoiceConfig } from '@/lib/voice/config'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ready = req.nextUrl.searchParams.get('check') === 'ready'
  if (!ready) return NextResponse.json({ status: 'live' })

  try {
    const cfg = getVoiceConfig()
    return NextResponse.json({
      status: 'ready',
      store: cfg.storeKind,
      providers: cfg.providers,
      outbound_enabled: cfg.outboundEnabled,
    })
  } catch (e) {
    return NextResponse.json({ status: 'unready', error: (e as Error).message }, { status: 503 })
  }
}
