import { NextResponse } from 'next/server'
import { openReader } from '../go-live-cards/access'
import {
  isLandingConfirmed,
  loadDraftPayload,
  readLandingPage,
  runLandingVerify,
  showLandingVerify,
  writeLandingReceipt,
} from '@/lib/ads-landing-verify'
import { ConfirmationCardError, issueConfirmationCard } from '@/lib/confirmation-card'
import { publicError } from '@/lib/confirmation-card/http'
import { KernelError } from '@/lib/kernel/errors'
import { getTrackingClientConfig } from '@/lib/ads-tracking-preflight/client-config'
import { createKernel } from '@/lib/kernel'
import { supabaseAdmin } from '@/lib/supabase'
import { parseDraftQuery, parseLandingRequest } from './http'

function asError(error: unknown): { status: number; message: string } {
  if (error instanceof ConfirmationCardError || error instanceof KernelError) return publicError(error)
  return { status: 500, message: '落地页核实暂时做不了。请稍后再试。' }
}

function siteOf(clientId: string): string | null {
  return getTrackingClientConfig(clientId)?.site_url ?? null
}

async function run(
  clientId: string,
  clicker: Parameters<typeof runLandingVerify>[0]['clicker'],
  draftId: string,
  again: boolean,
) {
  const kernel = createKernel(supabaseAdmin)
  return runLandingVerify({
    now: new Date(),
    siteUrl: siteOf(clientId),
    clicker,
    load: () => loadDraftPayload(supabaseAdmin, clientId, draftId),
    save: (payload, receipt) => writeLandingReceipt(supabaseAdmin, clientId, draftId, payload, receipt),
    confirmed: (receipt, accountLabel) => isLandingConfirmed(supabaseAdmin, clientId, draftId, accountLabel, receipt),
    issue: (facts) => issueConfirmationCard(kernel, { clientId, clicker, facts }),
    readPage: (url) => readLandingPage(url, { siteUrl: siteOf(clientId) ?? '' }),
  }, draftId, again)
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const gate = await openReader(req, params.id)
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  try {
    const draftId = parseDraftQuery(req.url)
    const result = await showLandingVerify({
      now: new Date(),
      load: () => loadDraftPayload(supabaseAdmin, params.id, draftId),
      confirmed: (receipt, accountLabel) => (
        isLandingConfirmed(supabaseAdmin, params.id, draftId, accountLabel, receipt)
      ),
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.view)
  } catch (error) {
    const mapped = asError(error)
    if (mapped.status === 500) console.error('[landing-verify] read failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await openReader(req, params.id)
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有核实。' }, { status: 400 })
  }
  try {
    const body = parseLandingRequest(raw)
    const result = await run(params.id, gate.clicker, body.draftId, body.again)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.view)
  } catch (error) {
    const mapped = asError(error)
    if (mapped.status === 500) console.error('[landing-verify] check failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
