import { NextRequest, NextResponse } from 'next/server'
import { buildMonthlyReport } from '@/lib/reports/monthly-aggregator'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

/**
 * GET /api/reports/[clientId]/monthly
 *
 * Returns aggregated monthly report data for a client.
 * Includes: AI visibility overview, 4-week trend, GEO deployment info,
 * and competitive comparison for top 10 queries.
 *
 * Reference: ROADMAP.md P7.4.1–P7.4.5
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { clientId: string } },
) {
  const access = await requirePaidClientAccess(params.clientId)
  if (!access.ok) {
    return NextResponse.json(
      { success: false, error: access.error, reason: access.reason },
      { status: access.status },
    )
  }

  try {
    const { clientId } = params

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: 'clientId is required' },
        { status: 400 },
      )
    }

    const report = await buildMonthlyReport(clientId)

    return NextResponse.json({ success: true, report })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
