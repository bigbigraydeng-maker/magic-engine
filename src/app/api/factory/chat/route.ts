// P21.J P2 — POST /api/factory/chat(spec me-native-design v0.2)
// 客户页嵌入的内容工厂对话助手。审核动作层前脸②(打回/调预算走对话,通过仍走 UI 按钮)。
// authz=guardAdmin;client-scoped(工具只操作 body.client_id 的工单)。stateless(history 前端传)。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin, requireAdmin } from '@/lib/auth/require-admin'
import { chatWithFactory } from '@/lib/factory/chat'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const guard = await guardAdmin()
  if (guard) return guard
  const admin = await requireAdmin()
  const reviewer = admin.ok ? (admin.user.email ?? 'admin') : 'admin'

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const clientId = typeof body.client_id === 'string' ? body.client_id : ''
  const message = typeof body.message === 'string' ? body.message : ''
  if (!UUID_RE.test(clientId)) return NextResponse.json({ error: 'client_id must be a uuid' }, { status: 400 })
  if (!message.trim()) return NextResponse.json({ error: 'message required' }, { status: 400 })

  const history = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter((m): m is { role: 'user' | 'assistant'; content: string } => {
          const r = (m as { role?: unknown }).role
          const c = (m as { content?: unknown }).content
          return (r === 'user' || r === 'assistant') && typeof c === 'string'
        })
        .slice(-12)
    : []

  const { data: client } = await supabaseAdmin.from('clients').select('name').eq('id', clientId).maybeSingle()
  const clientName = client?.name ?? '该客户'

  try {
    const result = await chatWithFactory(supabaseAdmin, clientId, clientName, reviewer, message, history)
    return NextResponse.json({ text: result.text, tool_calls: result.tool_calls })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[factory chat] ${msg}`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
