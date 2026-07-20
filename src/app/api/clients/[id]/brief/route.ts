import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'

/**
 * GET /api/clients/[id]/brief
 *   ?status=active      → returns the active brief (default)
 *   ?status=draft       → latest draft
 *   ?status=all         → all briefs ordered by version desc
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireOnboardingClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const status = req.nextUrl.searchParams.get('status') ?? 'active'

    let query = supabaseAdmin
      .from('master_briefs')
      .select('*')
      .eq('client_id', params.id)
      .order('version', { ascending: false })

    if (status === 'all') {
      // return all briefs as array
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ briefs: data ?? [] })
    }

    if (status === 'active') {
      // Check new status field first, fall back to is_active for older rows
      query = query.or('status.eq.active,is_active.eq.true').limit(1)
    } else {
      query = query.eq('status', status).limit(1)
    }

    const { data, error } = await query.single()
    if (error && error.code !== 'PGRST116') throw error
    return NextResponse.json({ brief: data ?? null })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PUT /api/clients/[id]/brief
 * @deprecated Use POST /api/clients/[id]/brief/generate instead.
 * Kept for backward compatibility with the old manual-entry form.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireOnboardingClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = await req.json()
    const {
      brand_name,
      tone,
      primary_audience,
      visual_style,
      content_topics,
      products,
    } = body

    // Deactivate old briefs (legacy is_active flag)
    await supabaseAdmin
      .from('master_briefs')
      .update({ is_active: false, status: 'archived' })
      .eq('client_id', params.id)

    const { data: existing } = await supabaseAdmin
      .from('master_briefs')
      .select('version')
      .eq('client_id', params.id)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    const nextVersion = (existing?.version ?? 0) + 1

    const { data, error } = await supabaseAdmin
      .from('master_briefs')
      .insert({
        client_id: params.id,
        version: nextVersion,
        is_active: true,
        status: 'active',
        brand_name: brand_name || 'Unnamed Brand',
        tone: tone || null,
        primary_audience: primary_audience || null,
        visual_style: visual_style || null,
        content_topics: content_topics || null,
        products: products || null,
        generated_by: 'manual',
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ brief: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
