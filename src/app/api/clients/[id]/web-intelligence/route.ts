import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { readView, saveSettings } from '@/lib/web-intelligence/service'
import { requestSchema } from '@/lib/web-intelligence/contracts'
import { canonicalDomain, approvedUrl } from '@/lib/web-intelligence/targets'
import { authorize } from '@/lib/web-intelligence/runner'
import { inngest } from '@/lib/inngest/client'
import { WEB_CAPTURE_EVENT } from '@/lib/inngest/functions/web-intelligence'

type Context = { params: Promise<{ id: string }> }
export async function GET(_req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try { return NextResponse.json(await readView(id, access.role === 'admin')) }
  catch { return NextResponse.json({ error: 'Website monitoring is not available. Check setup and try again.' }, { status: 503 }) }
}
export async function PATCH(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Administrator required' }, { status: 403 })
  try {
    const body = await req.json() as { settings?: unknown }
    await saveSettings(id, body.settings)
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: 'Settings not saved. Check budget, exchange-rate date, collector version and rollout access.' }, { status: 400 }) }
}
export async function POST(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Administrator required' }, { status: 403 })
  try {
    const body = await req.json() as { domain: string; url: string; request_id?: string }
    const domain = canonicalDomain(body.domain)
    const request = requestSchema.parse({ client_id: id, request_id: body.request_id ?? randomUUID(), domain, url: approvedUrl(body.url, domain) })
    // Persist the reserved request before handing off. Failed dispatch retains its receipt.
    const run = await authorize(request)
    request.request_id = run.id
    await inngest.send({ id: run.id, name: WEB_CAPTURE_EVENT, data: request })
    return NextResponse.json({ request_id: run.id, status: 'queued' }, { status: 202 })
  } catch { return NextResponse.json({ error: 'Capture could not be queued. Check configured URLs, entitlement, budget and any unresolved runs.' }, { status: 409 }) }
}
