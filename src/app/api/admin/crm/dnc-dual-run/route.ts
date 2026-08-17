/**
 * GET /api/admin/crm/dnc-dual-run?clientId=<uuid>
 *
 * 「能不能联系他」双跑对比 —— **只读，一行写操作都没有**。
 *
 * 产出一份名单：把拒联判据改成「只看事实」之后，**哪些人会重新开始收到
 * 我们的消息**。切换之前这份名单必须被人一个个看过（方案
 * `docs/specs/2026-08-17-crm-facts-first-redesign-v1.md` §8）。
 *
 * 为什么做成接口而不是脚本：数据在正式库里，本地跑不了。做成接口，
 * 部署环境里就能直接看结果 —— 而不是写一份「请谁谁去连数据库执行一下」的
 * 人工步骤（铁律 3）。
 *
 * Responses: 200 { clientId, ...对比结果 } / 400 缺 clientId / 403 admin-only / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { compareDncVerdicts, type DualRunContact } from '@/lib/crm/dnc-dual-run'
import type { DncTouch } from '@/lib/crm/dnc'

/** `.in()` 一次最多塞多少个 id —— 同 `qualified-buyer-autotag`，理由见那边。 */
const IN_CHUNK = 100

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface ContactRow {
  id: string
  display_name: string | null
  do_not_contact: boolean | null
}

interface TouchRow {
  contact_id: string
  occurred_at: string
  metadata: Record<string, unknown> | null
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: '缺 clientId' }, { status: 400 })
  }

  try {
    // 全量联系人 —— 分页拉完，不能只拿前 1000 个（那正是这个仓库踩过的坑）。
    const contacts = await fetchAll<ContactRow>((from, to) =>
      supabaseAdmin
        .from('contacts')
        .select('id, display_name, do_not_contact')
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
    )
    if (contacts.length === 0) {
      return NextResponse.json({ clientId, examined: 0, blockedNow: 0, blockedFactsOnly: 0, wouldUnblock: [], unexpectedNewBlocks: [] })
    }

    const ids = contacts.map((c) => c.id)
    const touches: TouchRow[] = []
    for (const part of chunk(ids, IN_CHUNK)) {
      const rows = await fetchAll<TouchRow>((from, to) =>
        supabaseAdmin
          .from('contact_touchpoints')
          .select('contact_id, occurred_at, metadata')
          .in('contact_id', part)
          .order('id', { ascending: true })
          .range(from, to),
      )
      touches.push(...rows)
    }

    const byContact = new Map<string, DncTouch[]>()
    for (const t of touches) {
      const meta = (t.metadata ?? {}) as Record<string, unknown>
      const list = byContact.get(t.contact_id) ?? []
      list.push({
        outcome: (meta.outcome as string) ?? null,
        flagged: meta.do_not_contact === true,
        occurredAt: t.occurred_at,
      })
      byContact.set(t.contact_id, list)
    }

    const input: DualRunContact[] = contacts.map((c) => ({
      id: c.id,
      displayName: c.display_name,
      flag: c.do_not_contact === true,
      touches: byContact.get(c.id) ?? [],
    }))

    return NextResponse.json({ clientId, ...compareDncVerdicts(input) })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '对比失败' },
      { status: 500 },
    )
  }
}
