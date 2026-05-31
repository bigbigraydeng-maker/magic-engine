import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { invalidateBriefCache } from '@/lib/brief/completion'

// GET /api/clients/[id]/light-brief
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('brief_fields, brief_completed_at')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Failed to load brief' }, { status: 500 })

  return NextResponse.json({
    brief_fields: (data?.brief_fields as Record<string, string> | null) ?? null,
    brief_completed_at: data?.brief_completed_at ?? null,
  })
}

// POST /api/clients/[id]/light-brief
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = await req.json().catch(() => null)
  const { company_name, industry, target_audience, core_differentiator, brand_voice } = body ?? {}

  if (!company_name || !industry || !target_audience || !core_differentiator || !brand_voice) {
    return NextResponse.json({ error: 'All 5 brief fields are required' }, { status: 400 })
  }

  const brief_fields = { company_name, industry, target_audience, core_differentiator, brand_voice }

  const { error } = await supabaseAdmin
    .from('clients')
    .update({ brief_fields, brief_completed_at: new Date().toISOString() })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: 'Failed to save brief' }, { status: 500 })

  invalidateBriefCache(params.id)

  return NextResponse.json({ ok: true })
}
