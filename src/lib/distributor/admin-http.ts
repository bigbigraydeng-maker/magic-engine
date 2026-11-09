/**
 * Shared request plumbing for /api/admin/distributors/*: global-admin only (scoped demo admins are
 * refused — this is money across all clients), same-origin writes only, JSON body parsing.
 */
import { NextResponse } from 'next/server'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { DistributorStoreError } from './store'

export type AdminGate = { ok: true; email: string } | { ok: false; response: NextResponse }

export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    const selfHost = req.headers.get('x-forwarded-host') ?? new URL(req.url).host
    return new URL(origin).host !== selfHost
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
