import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isBriefComplete } from '@/lib/brief/completion'
import { clientPortalMembershipsForUser } from '@/lib/auth/client-portal-membership'

// GET /api/clients/[id]/brief-status
// Returns the UX gate state for self_serve clients. Admin/FDE users fail open.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    )
  }

  if (access.role === 'admin') {
    return NextResponse.json({ complete: true, gated: false, reason: 'admin' })
  }

  const { rows, error } = await clientPortalMembershipsForUser(access.user)

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load brief gate status' },
      { status: 500 },
    )
  }

  const portalRow = rows.find(row => row.client_id === params.id)
  if (portalRow?.access_type !== 'self_serve') {
    return NextResponse.json({ complete: true, gated: false, reason: 'bypass' })
  }

  const complete = await isBriefComplete(params.id)
  return NextResponse.json({
    complete,
    gated: !complete,
    briefUrl: `/dashboard/clients/${params.id}/brief`,
  })
}
