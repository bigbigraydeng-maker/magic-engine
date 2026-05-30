/**
 * GET  /api/clients/[id]/locale  — returns current locale data (incl. confirmed status)
 * PATCH /api/clients/[id]/locale  — update + confirm locale fields
 *
 * Phase 26 — Client Locale Intelligence
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

type RouteContext = { params: { id: string } }

const LOCALE_FIELDS = 'id, semrush_db, country, state_code, city, business_scope, locale_confirmed_at'

const AU_STATES = ['VIC','NSW','QLD','WA','SA','TAS','ACT','NT']
const NZ_REGIONS = ['AKL','WLG','CAN','OTG','HKB','NLS','MBR','STH','TRK','WKO']

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select(LOCALE_FIELDS)
    .eq('id', params.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Infer country if not set
  const country = data.country ?? (data.semrush_db === 'nz' ? 'NZ' : 'AU')

  return NextResponse.json({
    locale: {
      country,
      state_code:          data.state_code ?? null,
      city:                data.city ?? null,
      business_scope:      data.business_scope ?? 'local',
      locale_confirmed_at: data.locale_confirmed_at ?? null,
    },
    au_states:  AU_STATES,
    nz_regions: NZ_REGIONS,
  })
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: {
    country?: string
    state_code?: string | null
    city?: string | null
    business_scope?: string
    confirm?: boolean
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if (body.country && ['AU','NZ'].includes(body.country)) {
    update.country = body.country
    // Keep semrush_db in sync for backward compat
    update.semrush_db = body.country === 'NZ' ? 'nz' : 'au'
  }
  if ('state_code' in body) update.state_code = body.state_code || null
  if ('city' in body)       update.city        = body.city        || null
  if (body.business_scope && ['local','state','national'].includes(body.business_scope)) {
    update.business_scope = body.business_scope
  }
  if (body.confirm === true) {
    update.locale_confirmed_at = new Date().toISOString()
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .update(update)
    .eq('id', params.id)
    .select(LOCALE_FIELDS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, locale: data })
}
