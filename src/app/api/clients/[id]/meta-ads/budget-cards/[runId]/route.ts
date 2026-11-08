/**
 * Confirm or decline one budget-step card.
 * A confirm asks the existing budget path to run once, then records its read-back.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'
import { parseDecisionBody, publicError } from '@/lib/confirmation-card/http'
import { submitBudgetCard } from '@/lib/ads-budget-card/flow'
import { kernelBudgetPath } from '@/lib/ads-budget-card/kernel-path'
import { metaBudgetRuntime } from '@/lib/ads-budget-card/meta'
import { prescriptionLockSource } from '@/lib/ads-budget-card/prescription-lock'
import { budgetCardGate, budgetKernel } from '../access'

export async function POST(
  req: Request,
  { params }: { params: { id: string; runId: string } },
) {
  const { id, runId } = params
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
  const kernel = budgetKernel()
  try {
    const result = await submitBudgetCard({
      kernel,
      clientId: id,
      runId,
      clicker: gate.clicker,
      runtime,
      locks: prescriptionLockSource(supabaseAdmin),
      path: kernelBudgetPath(kernel),
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
