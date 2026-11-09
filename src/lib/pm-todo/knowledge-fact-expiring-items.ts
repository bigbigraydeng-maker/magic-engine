/**
 * 今日待办里的「客户资料库有信息快过期了」(issue #1589 第 4 栏)。
 *
 * `client_knowledge_facts.valid_until` 一过期，AI 客服的读取入口
 * （`src/lib/knowledge/read.ts` 的有效期闸）就把这条事实当「不存在」处理——
 * 不会报错，也不会提醒任何人，AI 客服只是突然答不出本来能答的问题
 * （团期/价格等）。这一栏在到期前 14 天把这些行摆到人眼前，取代原 v2 设计
 * 里针对 `offerings.yaml` 的「超 7 天复核」（那条路线已被 client_knowledge_facts
 * 取代，`offerings.yaml`/`loadOfferings()` 在当前代码里已经没有生产调用方）。
 *
 * 🔴 门户「客户知识库」页（`/dashboard/clients/[id]/knowledge`）目前只做两件
 *    事：裁决 `status='candidate'` 的候选、给未确认的敏感事实发确认链接——
 *    对**已经批准**的事实（这里报的正是这类）**没有续期/编辑入口**（Codex
 *    复审 2026-09-15：之前的 how 写"打开页面延长有效期"，但页面上根本没有
 *    这个按钮，等于承诺了一件做不到的事）。设计文档里给的官方兜底是"直接找
 *    Ray 在数据库里改"（`~/.claude/plans/cts-tours-messenger-dynamic-pearl.md`
 *    §Layer1"紧急改价 SOP"）——这里按那条真实存在的路径写 how，不是按一个
 *    还没建的自助页面写。
 *
 * 拉模式：直接查表，不依赖任何事件送达。只看 `status='approved'` 的行——
 * 还没批准/已拒绝/已退役的行不需要续期提醒。只处理仍在服务的客户（见
 * messenger-draft-items.ts 同一处理，理由一致）。用 `fetchAll` 分页读
 * 全——原因同 messenger-draft-items.ts 头注：`.limit()` 单次硬顶 1000 行会
 * 静默截断。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import type { ClientRow } from './client-roster'
import { fetchAll } from '@/lib/supabase-paginate'

const APP_BASE = 'https://app.magicengine.com.au'
const EXPIRING_WINDOW_DAYS = 14

type FactRow = {
  client_id: string
  valid_until: string
}

type Bucket = { count: number; soonestIso: string }

function daysUntil(iso: string, now: Date): number {
  return Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000)
}

export async function pushKnowledgeFactExpiringItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clients: Map<string, ClientRow>,
  now: Date,
): Promise<void> {
  const cutoff = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000).toISOString()
  const rows = await fetchAll<FactRow>((from, to) =>
    supabase
      .from('client_knowledge_facts')
      .select('client_id, valid_until')
      .eq('status', 'approved')
      .not('valid_until', 'is', null)
      .lte('valid_until', cutoff)
      .order('valid_until', { ascending: true })
      .range(from, to),
  )

  const byClient = new Map<string, Bucket>()
  for (const row of rows) {
    // 已下线的客户不再进今日待办——理由同 messenger-draft-items.ts。
    if (!clients.has(row.client_id)) continue
    const cur = byClient.get(row.client_id)
    if (!cur || row.valid_until < cur.soonestIso) {
      byClient.set(row.client_id, { count: (cur?.count ?? 0) + 1, soonestIso: row.valid_until })
    } else {
      cur.count += 1
    }
  }

  for (const [clientId, agg] of Array.from(byClient.entries())) {
    const name = clients.get(clientId)?.name ?? '未知客户'
    const days = daysUntil(agg.soonestIso, now)
    const dueText = days <= 0 ? '已经过期' : `还有 ${days} 天过期`
    items.push({
      kind: 'knowledge_fact_expiring_soon',
      client_id: clientId,
      client_name: name,
      what: `${name} 的客户资料库有 ${agg.count} 条信息（团期/价格等）快到期了，最早一条${dueText}——过期后 AI 客服不能再用这条信息回复客户`,
      how: '这类信息目前还没有自助续期的按钮，确认内容还准确的话，回一句给 Ray，我们直接在数据库里帮你延长有效期；内容变了的话，把新说法发给我们重新走一遍审批',
      href: `${APP_BASE}/dashboard/clients/${clientId}/knowledge`,
    })
  }
}
