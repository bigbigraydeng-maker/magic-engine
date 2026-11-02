/**
 * Confirm or decline one budget card.
 * A confirm changes one ad set daily budget once, then reads it back.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'
import { parseDecisionBody, publicError } from '@/lib/confirmation-card/http'
import { submitBudgetCard } from '@/lib/ads-budget-card/flow'
import { metaBudgetRuntime } from '@/lib/ads-budget-card/meta'
import { budgetCardGate, budgetKernel } from '../access'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params
  const gate = await budgetCardGate(req, id)
  if (!gate.ok) return gate.response
  if (!isUuid(runId)) return NextResponse.json({ error: '找不到这张卡。' }, { status: 404 })
  let decision: ReturnType<typeof parseDecisionBody>
  try {
    decision = parseDecisionBody(await req.json())
  } catch (error) {
    const mapped = publicError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
  const runtime = await metaBudgetRuntime(id, supabaseAdmin)
  if (!runtime) return NextResponse.json({ error: '拿不到广告授权，没有改日预算。' }, { status: 424 })
  try {
    const result = await submitBudgetCard({
      kernel: budgetKernel(),
      clientId: id,
      runId,
      clicker: gate.clicker,
      runtime,
      ...decision,
    })
    if (!result.card) {
      const status = result.status === 'blocked' || result.status === 'failed' ? 409 : 200
      return NextResponse.json({ error: result.reason, status: result.status }, { status })
    }
    return NextResponse.json({ ...result.card, statusLine: result.reason })
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[budget-cards] confirm failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
