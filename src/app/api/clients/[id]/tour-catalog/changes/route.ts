import { NextRequest, NextResponse } from 'next/server'
import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { listChanges } from '@/lib/tour-catalog/store'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDS = 50

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAdmin(clientId)
  if (!access.ok) {
    return access.response
  }

  const ids = req.nextUrl.searchParams
    .getAll('entityId')
    .filter((id) => UUID_RE.test(id))
    .slice(0, MAX_IDS)

  try {
    const changes = await listChanges(supabaseAdmin, clientId, ids, 50)
    return NextResponse.json({ changes })
  } catch (err) {
    console.error('tour-catalog changes failed:', err)
    return NextResponse.json({ error: 'changes_failed' }, { status: 500 })
  }
}
