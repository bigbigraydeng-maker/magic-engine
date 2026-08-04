import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/clients/[id]/messenger/unclaimed/claim
 *
 * 认领一段 Facebook 对话：告诉系统「这是谁」。
 *
 * 两种动作：
 *   { conversationId, contactId }            接到已有联系人
 *   { conversationId, newContactName }       建一个新联系人再接上
 *
 * 关键在于**只认一次**：认领时把 fb_psid 写进 contact_identities，
 * 之后这个人再发任何消息，每小时同步都会 O(1) 命中，自动进「今天该联系谁」。
 * 所以 142 段积压是一次性清理，不是每天都要干的活。
 *
 * 认领同时补一条 inbound 触点 —— 否则人接上了，但那句「你们 9 月还有位子吗」
 * 仍然不在名单上，顾问还是看不到该回什么。
 *
 * Responses: 200 { contactId } / 400 / 401 / 403 / 404 / 500
 */

export const dynamic = 'force-dynamic'

interface Body {
  conversationId?: unknown
  contactId?: unknown
  newContactName?: unknown
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  const contactIdIn = typeof body.contactId === 'string' ? body.contactId : ''
  const newName = typeof body.newContactName === 'string' ? body.newContactName.trim() : ''

  if (!conversationId) return NextResponse.json({ error: '缺少 conversationId' }, { status: 400 })
  if (!contactIdIn && !newName) {
    return NextResponse.json({ error: '要么选一个已有客户，要么给新客户一个名字' }, { status: 400 })
  }

  // 对话必须属于这个客户，否则换个 id 就能改到别家的数据
  const { data: convo } = await supabaseAdmin
    .from('conversations')
    .select('id, participant_psid, participant_name, contact_id')
    .eq('id', conversationId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!convo) return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  if (convo.contact_id) {
    return NextResponse.json({ contactId: convo.contact_id as string, alreadyClaimed: true })
  }

  let contactId = contactIdIn

  if (contactId) {
    // 指定的联系人也必须属于这个客户
    const { data: exists } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('client_id', clientId)
      .maybeSingle()
    if (!exists) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })
  } else {
    const { data: created, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        client_id: clientId,
        display_name: newName,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error || !created) {
      console.error('[messenger/claim] 建联系人失败:', error?.message)
      return NextResponse.json({ error: '新建客户失败' }, { status: 500 })
    }
    contactId = created.id as string
  }

  // 这一步才是「只认一次」的关键：把 Facebook 账号绑到这个人身上
  const psid = convo.participant_psid as string
  if (psid) {
    await supabaseAdmin.from('contact_identities').upsert(
      { contact_id: contactId, client_id: clientId, kind: 'fb_psid', value: psid, first_source: 'messenger' },
      { onConflict: 'client_id,kind,value', ignoreDuplicates: true },
    )
  }

  await supabaseAdmin
    .from('conversations')
    .update({ contact_id: contactId, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  // 把最后一条客户消息补成触点，否则人接上了但那句话仍然不在名单上
  const { data: lastMsg } = await supabaseAdmin
    .from('conversation_messages')
    .select('body, created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastMsg) {
    await supabaseAdmin.from('contact_touchpoints').upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        channel: 'messenger',
        direction: 'inbound',
        occurred_at: lastMsg.created_at as string,
        summary: (lastMsg.body as string)?.slice(0, 500) ?? null,
        source: 'messenger',
        source_ref: `${conversationId}:in`,
      },
      { onConflict: 'client_id,source,source_ref' },
    )
  }

  return NextResponse.json({ contactId })
}
