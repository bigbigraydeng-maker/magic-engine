import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/clients/[id]/messenger/unclaimed
 *
 * 认不出是谁的 Facebook 对话。
 *
 * 同步是通的（每小时一次），但只有能匹配到**已存在联系人**的对话才会生成触点 ——
 * 这是有意的保守设计（早期版本会凭空造出假客户并把几十段对话错并上去）。
 * 代价是陌生人第一次发消息永远进不了「今天该联系谁」：CTS 450 段对话里
 * 142 段（32%）卡在这里，且全部最近一周还有活动。
 *
 * 这个端点把那批人摆出来，并给出「这可能是谁」的猜测，让顾问一点确认。
 * 人判断身份，系统只负责把候选列出来。
 *
 * Responses: 200 { items, total } / 401 / 403 / 500
 */

export const dynamic = 'force-dynamic'

/** 名字归一化后取「姓」——「Dot Balderston」与「Dorothy Balderston」靠这个对上。 */
function surname(name: string): string {
  const parts = name.trim().toLowerCase().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? ''
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const [{ data: convos }, { data: contacts }] = await Promise.all([
      supabaseAdmin
        .from('conversations')
        .select('id, participant_name, participant_psid, updated_at')
        .eq('client_id', clientId)
        .is('contact_id', null)
        .order('updated_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('contacts')
        .select('id, display_name, primary_phone, primary_email')
        .eq('client_id', clientId)
        .not('display_name', 'is', null),
    ])

    // 姓 → 候选联系人。同姓多人时全给出来，让顾问选，不替他决定。
    const bySurname = new Map<string, Array<{ id: string; name: string; phone: string | null }>>()
    for (const c of contacts ?? []) {
      const key = surname(c.display_name as string)
      if (!key) continue
      const list = bySurname.get(key) ?? []
      list.push({
        id: c.id as string,
        name: c.display_name as string,
        phone: (c.primary_phone as string) ?? null,
      })
      bySurname.set(key, list)
    }

    const ids = (convos ?? []).map((c) => c.id as string)
    const lastByConvo = new Map<string, { body: string | null; at: string }>()
    if (ids.length > 0) {
      const { data: msgs } = await supabaseAdmin
        .from('conversation_messages')
        .select('conversation_id, body, created_at, direction')
        .in('conversation_id', ids)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
      for (const m of msgs ?? []) {
        const cid = m.conversation_id as string
        if (!lastByConvo.has(cid)) {
          lastByConvo.set(cid, { body: (m.body as string) ?? null, at: m.created_at as string })
        }
      }
    }

    const items = (convos ?? []).map((c) => {
      const name = (c.participant_name as string) ?? ''
      const last = lastByConvo.get(c.id as string)
      return {
        conversationId: c.id as string,
        psid: c.participant_psid as string,
        fbName: name || '（无名字）',
        lastMessage: last?.body ?? null,
        lastMessageAt: last?.at ?? (c.updated_at as string),
        // 猜测而已 —— 顾问确认前不写任何东西
        candidates: name ? (bySurname.get(surname(name)) ?? []) : [],
      }
    })

    return NextResponse.json({ items, total: items.length })
  } catch (error) {
    const msg = error instanceof Error ? error.message : '读取失败'
    console.error('[messenger/unclaimed]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
