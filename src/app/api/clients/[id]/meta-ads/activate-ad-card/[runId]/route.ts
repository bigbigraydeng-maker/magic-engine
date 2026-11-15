/**
 * Confirm or decline one activate-ad card.
 * Meta is written only after confirm, and only once.
 */

import { NextResponse } from 'next/server'
import { confirmActivateCard } from '@/lib/ads-activate-card/flow'
import { makeActivateDeps } from '@/lib/ads-activate-card/runtime'
import { parseDecisionBody, publicError } from '@/lib/confirmation-card/http'
import { createKernel } from '@/lib/kernel'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'
import { activateAdCardGate } from '../access'

export async function POST(req: Request, { params }: { params: { id: string; runId: string } }) {
  const gate = await activateAdCardGate(req, params.id)
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
    const result = await confirmActivateCard({
      kernel: createKernel(supabaseAdmin),
      clientId: params.id,
      runId: params.runId,
      clicker: gate.clicker,
      deps: makeActivateDeps(supabaseAdmin, params.id),
      ...body,
    })
    if (!result.card) return NextResponse.json({ error: result.reason }, { status: 409 })
    return NextResponse.json({ ...result.card, statusLine: result.reason })
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[activate-ad-card] confirm failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
