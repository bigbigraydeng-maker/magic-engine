import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { listPublishedVersions } from '@/lib/tour-catalog/store-publish'
import { listMemberEmails } from '@/lib/tour-catalog/store-access'
import { makeActorLabeler } from '@/lib/tour-catalog/changes-view'
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

  const access = await requireCatalogAccess(clientId, 'view')
  if (!access.ok) return access.response

  try {
    const all = await listPublishedVersions(supabaseAdmin, clientId, 50)
    if (access.viewer.role === 'me_admin') {
      return NextResponse.json<PublishHistoryResponse>({ versions: all })
    }
    // Client editors: no publish notes, and Magic Engine staff are not named.
    const label = makeActorLabeler(
      access.viewer.role,
      await listMemberEmails(supabaseAdmin, clientId),
      access.viewer.email,
    )
    const versions = all.map((version) => ({
      ...version,
      note: '',
      publishedBy: label(version.publishedBy.trim().toLowerCase()),
    }))
    return NextResponse.json<PublishHistoryResponse>({ versions })
  } catch (err) {
    console.error('tour-catalog publish history failed:', err)
    return NextResponse.json<PublishErrorResponse>({ error: 'publish_failed' }, { status: 500 })
  }
}
