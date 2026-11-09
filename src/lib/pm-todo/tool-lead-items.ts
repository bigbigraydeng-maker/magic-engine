/**
 * 「工具实验室有人留资了」→ 下发到「需要你动手」。
 *
 * `src/lib/tools-lab/lead-events.ts::recordToolLead` 写下的 `website_lead_events`
 * （cta_key='tool_signup'）此前是一张写完没人读的表——广告体检的自助开通、网站诊断
 * 发出报告，两条留资信号都只落库，从没进过任何人会看的地方（工具实验室共用库整理
 * · 验收条件②）。这个文件只做「读最近 24 小时的新留资 → 下发一条待办」，一行写操作
 * 都没有；跟进方式（打开客户后台看看 / 主动联系邮箱）都在待办的 href 里点。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientRow } from './client-roster'
import type { ManualItem } from './manual-items'

export type ToolLeadItemKind = 'tool_lead_needs_followup'

/** 后台入口。🔴 必须绝对网址，相对路径会被链接闸整条丢掉。 */
export const APP_BASE = 'https://app.magicengine.com.au'

const TOOL_LABEL: Record<string, string> = {
  'ads-check': 'Facebook 广告体检',
  'site-check': '网站免费诊断',
}

interface ToolLeadRow {
  id: string
  destination: string
  created_at: string
  metadata: Record<string, unknown> | null
}

function clientHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}`
}

export async function pushToolLeadItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clients: Map<string, ClientRow>,
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('website_lead_events')
    .select('id, destination, created_at, metadata')
    .eq('cta_key', 'tool_signup')
    .gte('created_at', since)
  if (error || !data) return

  for (const row of data as ToolLeadRow[]) {
    const meta = row.metadata ?? {}
    const toolLabel = TOOL_LABEL[row.destination] ?? row.destination
    const clientId = typeof meta.client_id === 'string' ? meta.client_id : null
    const email = typeof meta.email === 'string' ? meta.email : null
    const url = typeof meta.url === 'string' ? meta.url : null

    if (clientId) {
      // ads-check (or any future tool whose lead is an existing, already-registered client).
      items.push({
        kind: 'tool_lead_needs_followup',
        client_id: clientId,
        client_name: clients.get(clientId)?.name ?? '未知客户',
        what: `这个客户第一次用了「${toolLabel}」（工具实验室引流工具），是一个值得跟进的信号`,
        how: '打开客户后台看看这个客户最近的情况，考虑是否需要主动联系一下',
        href: clientHref(clientId),
      })
      continue
    }

    // site-check (an anonymous visitor — no existing client row; the CRM contacts table is scoped
    // per-client and has no home for Magic Engine's own prospects, see
    // src/lib/inngest/functions/tools-lab-lead-followup.ts's header comment for why this stops here).
    items.push({
      kind: 'tool_lead_needs_followup',
      client_id: 'infra',
      client_name: 'Magic Engine 工具实验室',
      what: `有访客用「${toolLabel}」留了邮箱${email ? `：${email}` : ''}${url ? `，诊断的网站是 ${url}` : ''}——这是一个潜在客户`,
      how: email ? `考虑主动写信到 ${email} 跟进` : '查一下这条线索的详细信息，考虑要不要跟进',
      href: `${APP_BASE}/dashboard`,
    })
  }
}
