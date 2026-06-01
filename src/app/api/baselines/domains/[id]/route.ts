import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// DELETE /api/baselines/domains/[id]
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin
    .from('baseline_domains')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// PATCH /api/baselines/domains/[id] — update notes / keywords / is_client
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json() as Partial<{
    keywords: string[]
    notes: string
    is_client: boolean
  }>

  const { data, error } = await supabaseAdmin
    .from('baseline_domains')
    .update(body)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
