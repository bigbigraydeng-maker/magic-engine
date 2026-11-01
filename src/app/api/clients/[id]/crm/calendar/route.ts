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
    for (let i = 0; i < contactIds.length; i += 200) {
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .select('id, display_name, primary_phone, do_not_contact')
        .eq('client_id', clientId)
        .in('id', contactIds.slice(i, i + 200))
      if (error) throw error
      contacts.push(...((data ?? []) as CallbackContactRow[]))
    }

    const items: DueItem[] = callbackItems(touches, contacts, month)
    const operator = await requireOperatorAccess(clientId)
    if (operator.ok) items.push(...ledgerDueItems(loadLedger().entries, month))

    return NextResponse.json({ month, items: sortDueItems(items), includesLedger: operator.ok })
  } catch (err) {
    console.error('[crm/calendar] failed', err)
    return NextResponse.json({ error: 'Failed to load calendar' }, { status: 500 })
  }
}
