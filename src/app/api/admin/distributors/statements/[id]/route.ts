/**
 * POST /api/admin/distributors/statements/[id] → { action: 'approve' | 'mark_paid' | 'void' }.
 * approve / mark_paid / voiding an approved statement: only people on ADS_SPEND_APPROVER_EMAILS (the same
 * "who may approve money" list the ads kernel uses; empty = nobody). Voiding a not-yet-approved statement: any global admin. Approving records consent to pay; "mark paid"
 * records a transfer done outside ME. Nothing here moves money.
 */
import { NextResponse } from 'next/server'
import { isSpendApproverEmail } from '@/lib/auth/whitelist'
import { gate, invalid, readJson, storeFailure } from '@/lib/distributor/admin-http'
import { actOnStatement, type StatementAction } from '@/lib/distributor/settlement-store'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req, true)
  if (!g.ok) return g.response
  const { id } = await params
  if (!UUID.test(id)) return invalid(['id must be a UUID'])
  const body = await readJson(req)
  const action = body !== null && typeof body === 'object' ? (body as { action?: unknown }).action : undefined
  if (action !== 'approve' && action !== 'mark_paid' && action !== 'void') return invalid(['action must be approve, mark_paid or void'])
  if ((action === 'approve' || action === 'mark_paid') && !isSpendApproverEmail(g.email)) {
    return NextResponse.json({ error: 'Only the payout approver can do this' }, { status: 403 })
  }
  try {
    const actorIsPayoutApprover = isSpendApproverEmail(g.email)
    return NextResponse.json({ statement: await actOnStatement(id.toLowerCase(), action satisfies StatementAction, g.email, { actorIsPayoutApprover }) })
  } catch (err) {
    return storeFailure(err)
  }
}
