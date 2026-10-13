import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { readJsonBody } from '@/lib/tour-catalog/http'
import { saveSettings } from '@/lib/tour-catalog/store-access'
import { getClientDomain } from '@/lib/tour-catalog/store'
import { validateSettings } from '@/lib/tour-catalog/settings-validation'
import type { CatalogSettings } from '@/lib/tour-catalog/catalog-contract'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'manage_settings')
  if (!access.ok) return access.response

  const read = await readJsonBody(req)
  if (!read.ok) return read.response

  try {
    const domain = await getClientDomain(supabaseAdmin, clientId)
    const validated = validateSettings(read.body, domain)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    const settings = await saveSettings(supabaseAdmin, clientId, validated.value, access.actor)
    return NextResponse.json<{ settings: CatalogSettings }>({ settings })
  } catch (err) {
    console.error('settings_save_failed', err)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
