/**
 * Shared request plumbing for /api/admin/distributors/*: global-admin only (scoped demo admins are
 * refused — this is money across all clients), same-origin writes only, JSON body parsing.
 */
import { NextResponse } from 'next/server'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { DistributorStoreError } from './store'

export type AdminGate = { ok: true; email: string } | { ok: false; response: NextResponse }

/**
 * Origins this app is served from: APP_URL (what getPublicOrigin uses on Render, where req.url is the
 * internal localhost address), the forwarded / Host header, and the request URL itself (local dev).
 */
function ownOrigins(req: Request): Set<string> {
  const out = new Set<string>()
  const add = (value: string | undefined | null) => {
    if (!value) return
    try {
      out.add(new URL(value).origin)
    } catch {
      /* ignore malformed config */
    }
  }
  add(process.env.APP_URL)
  add(process.env.NEXT_PUBLIC_APP_URL)
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (host) {
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    add(`${proto ?? (host.startsWith('localhost') ? 'http' : 'https')}://${host}`)
  }
  add(req.url)
  return out
}

/** Writes must carry an Origin header naming this app; browsers always send one on fetch / form POST. */
export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin || origin === 'null') return true
  try {
    return !ownOrigins(req).has(new URL(origin).origin)
  } catch {
    return true
  }
}

export async function gate(req: Request, write: boolean): Promise<AdminGate> {
  if (write && isCrossOrigin(req)) {
    return { ok: false, response: NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 }) }
  }
  const access = await requireGlobalAdmin()
  if (!access.ok) return { ok: false, response: NextResponse.json({ error: access.error }, { status: access.status }) }
  const email = (access.user.email ?? '').trim()
  if (!email) return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { ok: true, email }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return undefined
  }
}

export function invalid(errors: string[]): NextResponse {
  return NextResponse.json({ error: 'Invalid request', details: errors }, { status: 400 })
}

export function storeFailure(err: unknown): NextResponse {
  if (err instanceof DistributorStoreError) {
    return NextResponse.json({ error: err.status === 500 ? 'Database error' : err.message }, { status: err.status })
  }
  console.error('[distributor-admin] unexpected error:', err)
  return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
}
