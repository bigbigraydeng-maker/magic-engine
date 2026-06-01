import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getMonthlySpend, getMonthlyCap } from '@/lib/mtc/budget-guard'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const [spend, { cap }] = await Promise.all([
      getMonthlySpend(params.id),
      getMonthlyCap(params.id),
    ])

    const remaining = Math.max(0, cap - spend)
    const pct = cap > 0 ? Math.round((spend / cap) * 100) : 0

    return NextResponse.json({ spend, cap, remaining, pct })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
