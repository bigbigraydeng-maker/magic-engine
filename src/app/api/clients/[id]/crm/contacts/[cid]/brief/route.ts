/**
 * 一个客人最新一份 AI 简报 —— 抽屉顶部「AI 概况」卡用。
 *
 * 为什么单独一个接口、不并进时间线接口：
 *   2026-10-10 把 AI 摘要从时间线接口挪走了（并进列表的「该做什么」），时间线接口
 *   有专门的测试守着「不再查 conversation_briefs」。概况卡要的是**完整**简报
 *   （概况 / 想要什么 / 我们承诺过 / 顾虑），列表接口只带 intent + next_action，
 *   全带会把那页拖慢。所以抽屉打开时单独取一次 —— 开抽屉是人为动作，不是每页都发。
 *
 * 🔴 返回的内容是 AI 生成、**未经人工核实**（提示词已知偶尔编商业细节）。抽屉里
 *    标注「以原文为准」。这里只读、不写、无副作用。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import type { TimelineAiBrief } from '@/app/dashboard/clients/[id]/crm/_components/ContactTimeline'

interface RouteParams {
  params: { id: string; cid: string }
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id
  const contactId = params.cid

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // IDOR 闸：contact 必须属于 path client。
  const { data: contact, error: cErr } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!contact) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  // 这个人的对话（按 client_id + contact_id 收口，跨不了客户）。
  const { data: convs, error: vErr } = await supabaseAdmin
    .from('conversations')
    .select('id, channel')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })

  const convRows = (convs ?? []) as { id: string; channel: string | null }[]
  if (convRows.length === 0) return NextResponse.json({ brief: null })
  const convChannel = new Map(convRows.map((c) => [c.id, c.channel]))

  const { data, error } = await supabaseAdmin
    .from('conversation_briefs')
    .select('conversation_id, summary, customer_needs, objections, promises_made, next_action, intent_level, generated_at')
    .eq('client_id', clientId)
    .in('conversation_id', convRows.map((c) => c.id))
    .not('summary', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ brief: null })

  const summary = typeof data.summary === 'string' ? data.summary.trim() : ''
  if (!summary) return NextResponse.json({ brief: null })

  const brief: TimelineAiBrief = {
    summary,
    customerNeeds: strArr(data.customer_needs),
    objections: strArr(data.objections),
    promisesMade: strArr(data.promises_made),
    nextAction:
      typeof data.next_action === 'string' && data.next_action.trim() !== '' ? data.next_action.trim() : null,
    intentLevel: typeof data.intent_level === 'string' ? data.intent_level : null,
    channel: convChannel.get(String(data.conversation_id)) ?? null,
    generatedAt: typeof data.generated_at === 'string' ? data.generated_at : null,
  }
  return NextResponse.json({ brief })
}
