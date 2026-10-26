import { NextRequest, NextResponse } from 'next/server'
import { requireBookingAccess } from '@/lib/crm/booking-access'
import { withServerTiming } from '@/lib/crm/booking-http'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * Probe used by the CRM tabs: 200 means this person may see the payment overview tab.
 * It only runs the access gate; it reads nothing else and returns no data.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const start = performance.now()
  const { id: clientId } = await params

  const access = await requireBookingAccess(clientId, 'view')
  const gateMs = performance.now() - start
  if (!access.ok) return access.response

  return withServerTiming(NextResponse.json({ ok: true }), start, gateMs)
}
