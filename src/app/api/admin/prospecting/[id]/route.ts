/**
 * GET   /api/admin/prospecting/[id] — full detail for one prospect,
 *        including the heavy jsonb fields the list endpoint excludes.
 * PATCH /api/admin/prospecting/[id] — review-queue actions:
 *        { action: 'edit_email', subject, body }  outreach_ready only
 *        { action: 'mark_contacted' }             outreach_ready → contacted
 *        { action: 'archive' }                    any active status → archived
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import type { OutreachEmail } from '@/lib/prospecting/outreach'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const { data, error } = await supabaseAdmin
    .from('outbound_prospects')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json({ prospect: data })
}

type PatchBody =
  | { action: 'edit_email'; subject: string; body: string }
  | { action: 'mark_contacted' }
  | { action: 'archive' }

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => null) as PatchBody | null
  if (!body?.action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  if (body.action === 'edit_email') {
    const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 120) : ''
    const text    = typeof body.body === 'string' ? body.body.trim() : ''
    if (!subject || text.length < 20) {
      return NextResponse.json({ error: '主题和正文不能为空' }, { status: 400 })
    }
    // Merge onto the existing draft so angle/generated_at survive the edit.
    const { data: row, error: readError } = await supabaseAdmin
      .from('outbound_prospects')
      .select('outreach_email')
      .eq('id', params.id)
      .eq('status', 'outreach_ready')
      .maybeSingle()
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
    if (!row?.outreach_email) return NextResponse.json({ error: 'no draft to edit' }, { status: 409 })

    const updated: OutreachEmail = { ...(row.outreach_email as OutreachEmail), subject, body: text, edited: true }
    const { error } = await supabaseAdmin
      .from('outbound_prospects')
      .update({ outreach_email: updated, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('status', 'outreach_ready')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, outreach_email: updated })
  }

  if (body.action === 'mark_contacted') {
    const { data, error } = await supabaseAdmin
      .from('outbound_prospects')
      .update({ status: 'contacted', contacted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('status', 'outreach_ready')
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) return NextResponse.json({ error: 'not in outreach_ready' }, { status: 409 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'archive') {
    const { data, error } = await supabaseAdmin
      .from('outbound_prospects')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .in('status', ['discovered', 'audited', 'qualified', 'analyzed', 'outreach_ready'])
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) return NextResponse.json({ error: 'not archivable' }, { status: 409 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
