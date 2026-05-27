import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { guardAdmin } from '@/lib/auth/require-admin'

const SELECT_FIELDS = 'id, name, domain, created_at, semrush_db, plan_tier'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select(SELECT_FIELDS)
      .eq('id', params.id)
      .single()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ client: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardAdmin()
  if (guard) return guard

  try {
    const { error } = await supabaseAdmin
      .from('clients')
      .delete()
      .eq('id', params.id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardAdmin()
  if (guard) return guard

  try {
    const body = await req.json()
    const allowed = ['name', 'domain', 'semrush_db', 'plan_tier']
    const update: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .update(update)
      .eq('id', params.id)
      .select(SELECT_FIELDS)
      .single()

    if (error) throw error
    return NextResponse.json({ client: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
