/**
 * GET   /api/admin/prospecting/[id] — full detail for one prospect,
 *        including the heavy jsonb fields the list endpoint excludes.
 * PATCH /api/admin/prospecting/[id] — review-queue actions:
 *        { action: 'edit_email', subject, body }  outreach_ready only
 *        { action: 'mark_contacted' }             outreach_ready → contacted
 *        { action: 'archive' }                    any active status → archived
 *        { action: 'opt_out' }                    permanent do-not-contact
 *                                                 (honours the footer promise)
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
  | { action: 'opt_out' }

async function handleEditEmail(id: string, body: { subject?: unknown; body?: unknown }): Promise<NextResponse> {
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 120) : ''
  const text    = typeof body.body === 'string' ? body.body.trim() : ''
  if (!subject || text.length < 40) {
    return NextResponse.json({ error: '主题不能为空，正文至少 40 字符' }, { status: 400 })
  }

  // Read draft + version stamp; merge so angle/generated_at survive the edit.
  const { data: row, error: readError } = await supabaseAdmin
    .from('outbound_prospects')
    .select('outreach_email, updated_at')
    .eq('id', id)
    .eq('status', 'outreach_ready')
    .maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!row?.outreach_email) return NextResponse.json({ error: '草稿已不在待审状态（可能刚被处理）' }, { status: 409 })

  const updated: OutreachEmail = { ...(row.outreach_email as OutreachEmail), subject, body: text, edited: true }
  // Optimistic lock on updated_at: zero rows means the draft moved on (marked
  // contacted / edited elsewhere) between read and write — the caller must
  // know, or the edit silently vanishes.
  const { data: written, error } = await supabaseAdmin
    .from('outbound_prospects')
    .update({ outreach_email: updated, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'outreach_ready')
    .eq('updated_at', row.updated_at)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!written || written.length === 0) {
    return NextResponse.json({ error: '保存冲突：草稿刚被其他操作修改，请刷新后重试' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, outreach_email: updated })
}

async function transition(
  id: string,
  fromStatuses: string[],
  patch: Record<string, string>,
  conflictMessage: string,
): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin
    .from('outbound_prospects')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', fromStatuses)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: conflictMessage }, { status: 409 })
  return NextResponse.json({ ok: true })
}

const ACTIVE_STATUSES = ['discovered', 'audited', 'qualified', 'analyzed', 'outreach_ready']

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

  switch (body.action) {
    case 'edit_email':
      return handleEditEmail(params.id, body)
    case 'mark_contacted':
      return transition(params.id, ['outreach_ready'],
        { status: 'contacted', contacted_at: new Date().toISOString() }, '不在待审状态')
    case 'archive':
      return transition(params.id, ACTIVE_STATUSES, { status: 'archived' }, '当前状态不可归档')
    case 'opt_out':
      // Footer promise: "you won't hear from us again". Terminal from any
      // pre-conversion state — including contacted/replied, where the
      // unsubscribe reply actually arrives.
      return transition(params.id, [...ACTIVE_STATUSES, 'contacted', 'replied'],
        { status: 'opted_out' }, '当前状态不可标记拒收')
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
}
