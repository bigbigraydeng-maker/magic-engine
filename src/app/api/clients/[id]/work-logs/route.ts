import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'

interface Params { params: { id: string } }

// GET /api/clients/[id]/work-logs?limit=30
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await requireSession()
  if (!session.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('fde_work_logs')
    .select('id, log_date, summary, author_email, created_at')
    .eq('client_id', params.id)
    .order('log_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ logs: data })
}

// POST /api/clients/[id]/work-logs  { summary, log_date? }
export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireSession()
  if (!session.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const summary = (body.summary ?? '').trim()
  if (!summary) return NextResponse.json({ error: 'summary required' }, { status: 400 })

  const log_date = body.log_date ?? new Date().toISOString().slice(0, 10)
  const author_email = (session.user.email ?? '').toLowerCase()

  const { data, error } = await supabaseAdmin
    .from('fde_work_logs')
    .insert({ client_id: params.id, summary, log_date, author_email })
    .select('id, log_date, summary, author_email, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ log: data }, { status: 201 })
}
