/**
 * Ask for one budget-step card from an approved prescription.
 * Issuing the card does not change the budget.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { publicError } from '@/lib/confirmation-card/http'
import { issueBudgetCard } from '@/lib/ads-budget-card/flow'
import { metaBudgetRuntime } from '@/lib/ads-budget-card/meta'
import { prescriptionLockSource } from '@/lib/ads-budget-card/prescription-lock'
import { parseBudgetRequest } from '@/lib/ads-budget-card/request'
import { budgetCardGate, budgetKernel } from './access'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { id } = params
  const gate = await budgetCardGate(req, id)
  if (!gate.ok) return gate.response
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有出卡。' }, { status: 400 })
  }
  try {
    const order = parseBudgetRequest(raw)
    const runtime = await metaBudgetRuntime(id, supabaseAdmin)
    if (!runtime) return NextResponse.json({ error: '拿不到广告授权，没有出卡。' }, { status: 424 })
    const issued = await issueBudgetCard({
      kernel: budgetKernel(),
      clientId: id,
      clicker: gate.clicker,
      order,
      runtime,
      locks: prescriptionLockSource(supabaseAdmin),
    })
    if (!issued.card) return NextResponse.json({ error: issued.reason }, { status: 409 })
    return NextResponse.json({ ...issued.card, blockedReason: issued.reason ?? issued.card.blockedReason })
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[budget-cards] issue failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
