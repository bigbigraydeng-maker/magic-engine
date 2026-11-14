/**
 * Confirm or decline one add-creative card.
 * Meta is written only after confirm, and only as one new ad.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createKernel } from '@/lib/kernel'
import { isUuid } from '@/lib/validation-utils'
import { parseDecisionBody, publicError } from '@/lib/confirmation-card/http'
import { confirmCreativeCard } from '@/lib/ads-creative-card/flow'
import { addCreativeListExtrasForRun } from '@/lib/ads-creative-card/hold-display'
import { makeCreativeDeps } from '@/lib/ads-creative-card/runtime'
import { creativeCardGate } from '../access'

export async function POST(req: Request, { params }: { params: { id: string; runId: string } }) {
  const gate = await creativeCardGate(req, params.id)
  if (!gate.ok) return gate.response
  if (!isUuid(params.runId)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
  }
  try {
    const body = parseDecisionBody(raw)
    const result = await confirmCreativeCard({
      kernel: createKernel(supabaseAdmin),
      clientId: params.id,
      runId: params.runId,
      clicker: gate.clicker,
      deps: makeCreativeDeps(supabaseAdmin, params.id),
      ...body,
    })
    if (!result.card) return NextResponse.json({ error: result.reason }, { status: 409 })
    const extras = await addCreativeListExtrasForRun(supabaseAdmin, params.id, params.runId)
    const base = { ...result.card, statusLine: result.reason }
    if (!extras) return NextResponse.json(base)
    const withDetail = { ...base, addCreativeDetail: extras.detail }
    if (!extras.statusChip) return NextResponse.json(withDetail)
    return NextResponse.json({
      ...withDetail,
      addCreativeStatusChip: extras.statusChip,
      statusLine: extras.statusLine ?? result.reason,
    })
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[add-creative-card] confirm failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
