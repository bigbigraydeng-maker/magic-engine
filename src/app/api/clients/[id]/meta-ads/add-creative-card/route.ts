/**
 * Ask for one card that adds an image ad to an existing ad set.
 * Issuing the card does not call Meta.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createKernel } from '@/lib/kernel'
import { publicError } from '@/lib/confirmation-card/http'
import { issueCreativeCard } from '@/lib/ads-creative-card/flow'
import { parseCreativeRequest } from '@/lib/ads-creative-card/order'
import { makeCreativeDeps } from '@/lib/ads-creative-card/runtime'
import { creativeCardGate } from './access'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await creativeCardGate(req, params.id)
  if (!gate.ok) return gate.response
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有出卡。' }, { status: 400 })
  }
  try {
    const order = parseCreativeRequest(raw, params.id)
    const issued = await issueCreativeCard({
      kernel: createKernel(supabaseAdmin),
      clientId: params.id,
      clicker: gate.clicker,
      order,
      deps: makeCreativeDeps(supabaseAdmin, params.id),
    })
    if (!issued.card) return NextResponse.json({ error: issued.reason }, { status: 409 })
    return NextResponse.json(issued.card)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[add-creative-card] issue failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
