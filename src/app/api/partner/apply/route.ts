/**
 * POST /api/partner/apply → public distributor application (no login). Same-origin only, small JSON
 * bodies only, capped per source and globally per hour. Always creates a `pending` distributor that an
 * admin approves or rejects on /dashboard/admin/distributors; nothing here grants access or money.
 * Answers { ok: true } for a new application, an email that is already an active distributor and a
 * honeypot hit alike.
 */
import { NextResponse } from 'next/server'
import { isCrossOrigin, storeFailure } from '@/lib/distributor/admin-http'
import { clientIpFrom, hashApplicantIp, parseApplication, submitApplication } from '@/lib/distributor/application'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 8_000

/** Reads at most `limit` bytes, also for bodies sent without a content-length; null when longer. */
async function readLimited(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    all.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder().decode(all)
}

export async function POST(req: Request) {
  if (isCrossOrigin(req)) return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 })
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: '内容太长了，请精简留言后再提交' }, { status: 413 })
  const raw = await readLimited(req, MAX_BODY_BYTES)
  if (raw === null) return NextResponse.json({ error: '内容太长了，请精简留言后再提交' }, { status: 413 })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    body = undefined
  }
  const parsed = parseApplication(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.errors[0], details: parsed.errors }, { status: 400 })
  try {
    // Shape of the address headers only (never the addresses), to confirm on the live host which one
    // identifies the visitor: see ledger 2026-11-10-distributor-apply-page-built-without-lawyer.
    const hops = (req.headers.get('x-forwarded-for') ?? '').split(',').filter((s) => s.trim()).length
    console.info(`[distributor-apply] source headers: cf=${req.headers.has('cf-connecting-ip')} xff_hops=${hops} real_ip=${req.headers.has('x-real-ip')}`)
    await submitApplication(parsed.value, hashApplicantIp(clientIpFrom(req.headers)))
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    return storeFailure(err)
  }
}
