import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAdmin } from '@/lib/tour-catalog/access'
import { listPublishedVersions } from '@/lib/tour-catalog/store-publish'
import type {
  PublishErrorResponse,
  PublishHistoryResponse,
} from '@/lib/tour-catalog/publish-contract'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAdmin(clientId)
  if (!access.ok) return access.response

  try {
    const versions = await listPublishedVersions(supabaseAdmin, clientId, 50)
    return NextResponse.json<PublishHistoryResponse>({ versions })
  } catch (err) {
    console.error('tour-catalog publish history failed:', err)
    return NextResponse.json<PublishErrorResponse>({ error: 'publish_failed' }, { status: 500 })
  }
}
