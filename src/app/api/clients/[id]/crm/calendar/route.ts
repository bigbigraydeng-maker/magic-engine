/**
 * GET /api/clients/[id]/crm/calendar?month=YYYY-MM
 *
 * 到期日历的数据：本月客人约好的回电（所有付费 / 管理员可见）+ 台账验收日（仅内部身份可见，
 * 台账是我们自己的验证清单，不给客户角色看）。只读，不写任何东西。
 *
 * Responses: 200 { month, items, includesLedger } / 400 / 401 / 403 / 500
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorAccess, requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { loadLedger } from '@/lib/ledger/load'
import { isDoNotContact } from '@/lib/crm/dnc'
import {
  callbackItems,
  currentMonthNz,
  isValidMonth,
  ledgerDueItems,
  sortDueItems,
  type CallbackContactRow,
  type CallbackTouchRow,
  type DueItem,
} from '@/lib/crm/due-calendar'

export const dynamic = 'force-dynamic'

interface DncTouchRow {
  contact_id: string
  occurred_at: string
  metadata: unknown
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const requested = req.nextUrl.searchParams.get('month')
  if (requested !== null && !isValidMonth(requested)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }
  const month = requested ?? currentMonthNz()

  try {
    const touches = await fetchAll<CallbackTouchRow>((from, to) =>
      supabaseAdmin
        .from('contact_touchpoints')
        .select('contact_id, occurred_at, metadata')
        .eq('client_id', clientId)
        .not('metadata->>callback_at', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
    )
    const contactIds = Array.from(new Set(touches.map((t) => t.contact_id)))
    const contacts: CallbackContactRow[] = []
    for (let i = 0; i < contactIds.length; i += 100) {
      const ids = contactIds.slice(i, i + 100)
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .select('id, display_name, primary_phone, do_not_contact')
        .eq('client_id', clientId)
        .in('id', ids)
      if (error) throw error
      // 「别再联系」以触点为准（见 lib/crm/dnc），contacts 列只是尽力维护的副本
      const allTouches = await fetchAll<DncTouchRow>((from, to) =>
        supabaseAdmin
          .from('contact_touchpoints')
          .select('contact_id, occurred_at, metadata')
          .eq('client_id', clientId)
          .in('contact_id', ids)
          .order('id', { ascending: true })
          .range(from, to),
      )
      const byContact = new Map<string, DncTouchRow[]>()
      for (const t of allTouches) byContact.set(t.contact_id, [...(byContact.get(t.contact_id) ?? []), t])
      for (const c of (data ?? []) as CallbackContactRow[]) {
        const dnc = isDoNotContact(
          c.do_not_contact,
          (byContact.get(c.id) ?? []).map((t) => ({
            outcome: ((t.metadata as { outcome?: unknown } | null)?.outcome as string) ?? null,
            flagged: (t.metadata as { do_not_contact?: unknown } | null)?.do_not_contact === true,
            occurredAt: t.occurred_at,
          })),
        )
        contacts.push({ ...c, do_not_contact: dnc })
      }
    }

    const items: DueItem[] = callbackItems(touches, contacts, month)
    // 台账横跨所有客户：只给「不限客户的全局管理员」，演示 / 受限管理员只看自己客户的回电
    const operator = await requireOperatorAccess(clientId)
    const includesLedger = operator.ok && operator.allowedClientId === null
    if (includesLedger) {
      try {
        items.push(...ledgerDueItems(loadLedger().entries, month))
      } catch (err) {
        console.error('[crm/calendar] ledger unreadable, showing callbacks only', err)
      }
    }

    return NextResponse.json({ month, items: sortDueItems(items), includesLedger })
  } catch (err) {
    console.error('[crm/calendar] failed', err)
    return NextResponse.json({ error: 'Failed to load calendar' }, { status: 500 })
  }
}
