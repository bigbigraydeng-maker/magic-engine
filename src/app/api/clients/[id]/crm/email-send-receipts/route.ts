/**
 * GET /api/clients/[id]/crm/email-send-receipts   最近的发送回执（谁 / 给哪位客人 / 哪个模板 / 结果 / 被拦原因）
 *
 * 回执里没有邮箱地址、没有正文；客人只给姓名（链接到抽屉用 contactId）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { listRecentReceipts } from '@/lib/crm/email-templates/receipt-store'
import { supabaseAdmin } from '@/lib/supabase'

interface RouteParams {
  params: { id: string }
}

const LIMIT = 50

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const receipts = await listRecentReceipts(supabaseAdmin, params.id, LIMIT)
    const ids = Array.from(new Set(receipts.map((r) => r.contactId)))
    const names: Record<string, string | null> = {}
    if (ids.length > 0) {
      const { data, error } = await supabaseAdmin.from('contacts').select('id, display_name').eq('client_id', params.id).in('id', ids)
      if (error) throw new Error(`contacts: ${error.message}`)
      for (const row of (data as Array<{ id: string; display_name: string | null }> | null) ?? []) names[row.id] = row.display_name
    }
    return NextResponse.json({ receipts: receipts.map((r) => ({ ...r, contactName: names[r.contactId] ?? null })) })
  } catch (err) {
    console.error('[crm/email-send-receipts] 读取失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '发送记录暂时读不到，请联系 Magic Lab 团队。' }, { status: 503 })
  }
}
