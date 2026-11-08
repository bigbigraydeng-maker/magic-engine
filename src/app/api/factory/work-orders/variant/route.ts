// GET/POST /api/factory/work-orders/variant: order one variant of an already-rendered video.
// Internal staff only; the new order stops at in_review and never publishes.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { parseVariantRequest } from '@/lib/factory/variant-order'
import { createVariantOrder, getVariantBaseDetail, listVariantBases } from '@/lib/factory/variant-order-store'

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  const params = new URL(req.url).searchParams
  const base = params.get('base')
  const client = params.get('client')

  if (base !== null) {
    if (!UUID_RE.test(base)) {
      return NextResponse.json({ error: 'base must be a uuid' }, { status: 400 })
    }
    const result = await getVariantBaseDetail(supabaseAdmin, base)
    return result.ok
      ? NextResponse.json({ base: result.data })
      : NextResponse.json({ error: result.error }, { status: result.status })
  }

  if (client !== null && !UUID_RE.test(client)) {
    return NextResponse.json({ error: 'client must be a uuid' }, { status: 400 })
  }
  const result = await listVariantBases(supabaseAdmin, client)
  return result.ok
    ? NextResponse.json({ bases: result.data })
    : NextResponse.json({ error: result.error }, { status: result.status })
}

export async function POST(req: Request) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = parseVariantRequest(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const result = await createVariantOrder(supabaseAdmin, {
    baseId: parsed.baseId,
    change: parsed.change,
    note: parsed.note,
    actor: admin.user.email ?? 'unknown',
  })
  return result.ok
    ? NextResponse.json({ order: result.data }, { status: 201 })
    : NextResponse.json({ error: result.error }, { status: result.status })
}
