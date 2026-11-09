import { NextResponse } from 'next/server'
import { issueGoLive, loadGoLive, parseGoLiveIssue } from '@/lib/ads-go-live'
import { publicError } from '@/lib/confirmation-card/http'
import { createKernel } from '@/lib/kernel'
import { supabaseAdmin } from '@/lib/supabase'
import { openReader } from './access'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await openReader(req, params.id)
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
  }
  try {
    const draftId = parseGoLiveIssue(raw)
    const loaded = await loadGoLive(supabaseAdmin, params.id, draftId, new Date())
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    const body = await issueGoLive({
      kernel: createKernel(supabaseAdmin),
      clientId: params.id,
      clicker: gate.clicker,
      facts: loaded.facts,
    })
    return NextResponse.json(body)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[go-live-card] issue failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
