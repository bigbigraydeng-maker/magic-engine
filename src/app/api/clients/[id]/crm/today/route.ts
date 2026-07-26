/**
 * GET /api/clients/[id]/crm/today
 *
 * 今天该联系谁。分段和排序全在 lib/crm/segments 里算，这里只负责取数。
 *
 * 一次把这个客户的人和触点全拉出来在内存里分段 —— CTS 现在 335 人 / 634 触点，
 * 这个量级下比在 SQL 里堆窗口函数简单得多，也让分段规则能被单测直接钉住。
 * 到几千人再换成物化视图。
 *
 * Responses:
 *   200  { worklist, counts, generatedAt }
 *   401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { todayWorklist, segmentCounts, type ContactLike } from '@/lib/crm/segments'

interface RouteParams {
  params: { id: string }
}

interface ContactRow {
  id: string
  display_name: string | null
  primary_phone: string | null
  primary_email: string | null
  do_not_contact: boolean
}

interface TouchRow {
  contact_id: string
  channel: string
  direction: 'inbound' | 'outbound'
  occurred_at: string
  summary: string | null
  metadata: Record<string, unknown> | null
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const [{ data: contacts, error: cErr }, { data: touches, error: tErr }] = await Promise.all([
    supabaseAdmin
      .from('contacts')
      .select('id, display_name, primary_phone, primary_email, do_not_contact')
      .eq('client_id', clientId)
      .limit(5000),
    supabaseAdmin
      .from('contact_touchpoints')
      .select('contact_id, channel, direction, occurred_at, summary, metadata')
      .eq('client_id', clientId)
      .order('occurred_at', { ascending: false })
      .limit(20000),
  ])

  if (cErr || tErr) {
    return NextResponse.json({ error: cErr?.message ?? tErr?.message }, { status: 500 })
  }

  const byContact = new Map<string, TouchRow[]>()
  for (const t of (touches ?? []) as TouchRow[]) {
    const list = byContact.get(t.contact_id) ?? []
    list.push(t)
    byContact.set(t.contact_id, list)
  }

  const rows = (contacts ?? []) as ContactRow[]
  const models: ContactLike[] = rows.map((c) => ({
    id: c.id,
    displayName: c.display_name,
    doNotContact: c.do_not_contact,
    touchpoints: (byContact.get(c.id) ?? []).map((t) => ({
      channel: t.channel,
      direction: t.direction,
      occurredAt: t.occurred_at,
      outcome: (t.metadata?.outcome as string) ?? null,
      travelWindow: (t.metadata?.travel_window as string) ?? null,
      callbackAt: (t.metadata?.callback_at as string) ?? null,
    })),
  }))

  const now = new Date()
  const contactById = new Map(rows.map((c) => [c.id, c]))

  const worklist = todayWorklist(models, now)
    // 名单本身不封顶会变成没人看的长列表；截断要说出来（见页面底部）。
    .slice(0, 100)
    .map((c) => {
      const row = contactById.get(c.id)
      const last = (byContact.get(c.id) ?? [])[0]
      return {
        contactId: c.id,
        name: c.displayName || '未留姓名',
        phone: row?.primary_phone ?? null,
        email: row?.primary_email ?? null,
        segment: c.seg.segment,
        temperature: c.seg.temperature,
        reason: c.seg.reason,
        suggestedChannel: c.seg.suggestedChannel,
        dueAt: c.seg.dueAt,
        lastNote: last?.summary ?? null,
      }
    })

  return NextResponse.json({
    worklist,
    counts: segmentCounts(models, now),
    totalContacts: models.length,
    truncated: todayWorklist(models, now).length > worklist.length,
    generatedAt: now.toISOString(),
  })
}
