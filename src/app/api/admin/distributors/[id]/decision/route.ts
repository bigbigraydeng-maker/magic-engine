/**
 * POST /api/admin/distributors/[id]/decision → approve / reject / suspend / reinstate.
 * Approval records who approved and gives the distributor the starting level (standard).
 * Global admin only.
 */
import { NextResponse } from 'next/server'
import { parseDecision } from '@/lib/distributor/admin-input'
import { gate, invalid, readJson, storeFailure } from '@/lib/distributor/admin-http'
import { decideDistributor } from '@/lib/distributor/store'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req, true)
  if (!g.ok) return g.response
  const { id } = await params
  if (!UUID.test(id)) return invalid(['id must be a UUID'])
  const parsed = parseDecision(await readJson(req))
  if (!parsed.ok) return invalid(parsed.errors)
  try {
    return NextResponse.json({ distributor: await decideDistributor(id.toLowerCase(), parsed.value, g.email) })
  } catch (err) {
    return storeFailure(err)
  }
}
