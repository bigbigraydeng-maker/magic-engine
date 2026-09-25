import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * PATCH /api/clients/[id]/crm/contacts/[cid]/important
 *
 * 编辑「⭐置顶」附带的两列：原因（important_note）和到期日（important_due_at）。
 * 星本身（pinned_at）由 pin 路由管，这里只管"标了什么"和"到什么时候"。
 *
 * 两列都可空；note 传空串 = 清空；**缺 key = 不动这一列**（缺 ≠ 清空）。
 * IDOR：contact 必须属于 path 上的 client，否则 404。
 * 到期日到了 → pm-todo 会自动催（另一轮实现，本路由不管）。
 *
 * Body: { note?: string | null; dueAt?: string | null }
 * Responses: 200 { important: { note, dueAt } } / 400 / 401 / 403 / 404 / 500
 */

export const dynamic = 'force-dynamic'

const MAX_NOTE_LEN = 500

interface ImportantBody {
  note?: unknown
  dueAt?: unknown
}

/**
 * 把请求体解析成一份「只含出现过的 key」的 patch。
 *
 * 关键点：用 `'note' in body` 而不是 `body.note !== undefined` —— 前者能区分
 * 「没传这个 key」和「传了 null」，后者把两者混为一谈，于是清空和不动分不开。
 */
function parseImportantBody(raw: ImportantBody): {
  patch: Record<string, string | null>
  error: string | null
} {
  const patch: Record<string, string | null> = {}

  if ('note' in raw) {
    const v = raw.note
    if (v !== null && typeof v !== 'string') {
      return { patch, error: 'note 必须是字符串或 null' }
    }
    if (typeof v === 'string') {
      const trimmed = v.trim()
      if (trimmed.length > MAX_NOTE_LEN) {
        return { patch, error: `note 最多 ${MAX_NOTE_LEN} 个字` }
      }
      // 空串 = 清空（存 NULL），不是存一个空字符串。
      patch.important_note = trimmed.length === 0 ? null : trimmed
    } else {
      patch.important_note = null
    }
  }

  if ('dueAt' in raw) {
    const v = raw.dueAt
    if (v !== null && typeof v !== 'string') {
      return { patch, error: 'dueAt 必须是字符串或 null' }
    }
    if (typeof v === 'string') {
      const t = new Date(v).getTime()
      if (Number.isNaN(t)) {
        return { patch, error: 'dueAt 不是合法的时间' }
      }
      patch.important_due_at = new Date(t).toISOString()
    } else {
      patch.important_due_at = null
    }
  }

  return { patch, error: null }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; cid: string } },
): Promise<NextResponse> {
  const { id: clientId, cid } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: ImportantBody
  try {
    body = (await req.json()) as ImportantBody
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const { patch, error: parseErr } = parseImportantBody(body)
  if (parseErr) return NextResponse.json({ error: parseErr }, { status: 400 })

  // 必须带 client_id 一起查，否则换个 cid 就能改到别家客户的联系人
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', cid)
    .eq('client_id', clientId)
    .maybeSingle()

  if (findErr) {
    console.error('[crm/important] 查联系人失败:', findErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  // 空 patch（body 是 {}）→ 不写库，直接回当前值。省一次无谓的 UPDATE。
  if (Object.keys(patch).length === 0) {
    const { data: current, error: readErr } = await supabaseAdmin
      .from('contacts')
      .select('important_note, important_due_at')
      .eq('id', cid)
      .eq('client_id', clientId)
      .single()

    if (readErr) {
      console.error('[crm/important] 读取失败:', readErr.message)
      return NextResponse.json({ error: '操作失败' }, { status: 500 })
    }
    return NextResponse.json({
      important: { note: current.important_note, dueAt: current.important_due_at },
    })
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('contacts')
    .update(patch)
    .eq('id', cid)
    .eq('client_id', clientId)
    .select('important_note, important_due_at')
    .single()

  if (updateErr) {
    console.error('[crm/important] 更新失败:', updateErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }

  return NextResponse.json({
    important: { note: updated.important_note, dueAt: updated.important_due_at },
  })
}
