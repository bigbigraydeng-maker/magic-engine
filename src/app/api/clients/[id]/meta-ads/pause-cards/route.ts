/**
 * Build pause cards from approved plans and prescriptions. Does not pause by itself.
 */

import { NextResponse } from 'next/server'
import { publicError } from '@/lib/confirmation-card/http'
import { assemblePauseCards } from '@/lib/ads-pause-card/assemble'
import { metaPauseRuntime } from '@/lib/ads-pause-card/meta'
import { pauseCardGate, pauseKernel } from './access'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const gate = await pauseCardGate(req, id)
  if (!gate.ok) return gate.response
  const body = await req.json().catch(() => null)
  if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
    return NextResponse.json({ error: '出卡不需要额外内容。' }, { status: 400 })
  }
  const runtime = await metaPauseRuntime(id)
  if (!runtime) return NextResponse.json({ error: '拿不到广告授权，没有出卡。' }, { status: 424 })
  try {
    const assembled = await assemblePauseCards({
      kernel: pauseKernel(),
      clientId: id,
      clicker: gate.clicker,
      runtime,
    })
    if (!assembled.ok) return NextResponse.json({ error: assembled.reason }, { status: 503 })
    return NextResponse.json({ items: assembled.items })
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[pause-cards] issue failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
