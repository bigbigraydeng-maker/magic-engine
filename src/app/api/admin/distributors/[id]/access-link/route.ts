/**
 * POST /api/admin/distributors/[id]/access-link → a one-time login link (24h) to the distributor's own
 * read-only portal. The link is shown to the admin to send themselves; ME sends nothing.
 * DELETE → ends every login link and portal session of that distributor at once.
 * Global admin only. The raw token exists only in the POST response.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { gate, invalid, storeFailure } from '@/lib/distributor/admin-http'
import { createInvite, revokeAllAccess } from '@/lib/distributor/portal-auth'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req, true)
  if (!g.ok) return g.response
  const { id } = await params
  if (!UUID.test(id)) return invalid(['id must be a UUID'])
  try {
    const { token, expiresAt } = await createInvite(id.toLowerCase(), g.email)
    const origin = getPublicOrigin(req).replace(/\/$/, '')
    return NextResponse.json(
      { url: `${origin}/partner/enter?t=${token}`, expires_at: expiresAt },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    )
  } catch (err) {
    return storeFailure(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req, true)
  if (!g.ok) return g.response
  const { id } = await params
  if (!UUID.test(id)) return invalid(['id must be a UUID'])
  try {
    return NextResponse.json({ revoked: await revokeAllAccess(id.toLowerCase()) })
  } catch (err) {
    return storeFailure(err)
  }
}
