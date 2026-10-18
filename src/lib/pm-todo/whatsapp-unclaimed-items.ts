/**
 * 「有个 WhatsApp 号码在给我们发消息，但 ME 里没有任何客户绑定它」→ 今日待办。
 *
 * 号码在发消息、系统却不知道它属于哪个客户 —— 消息进不来、存不下，客人以为
 * 发出去了，我们这边什么都没有。只有人能去客户设置页把号码绑上（铁律 3 下半：
 * 确实只有人能做的事，必须下发成人工任务，不许只躺在日志里）。
 *
 * 这个文件一行写操作都没有（除了把「已经绑上了」的登记行标成已解决）。
 * 绑定动作在客户设置页里点。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

export type WhatsappUnclaimedItemKind = 'whatsapp_number_unclaimed'

/** 超过这个天数就不再每天来烦人（不删行，只是不再下发）。 */
const STALE_DAYS = 14
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000

/** 表还没上线时 PostgREST 会这么报 —— 静默跳过，不当故障。 */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

interface UnclaimedRow {
  phone_number_id: string
  last_seen_at: string | null
  last_kind: string | null
}

function isMissingTableError(error: { code?: string } | null): boolean {
  return error !== null && typeof error.code === 'string' && MISSING_TABLE_CODES.has(error.code)
}

/** 只取日期那一段（YYYY-MM-DD），算不出来就如实说算不出来。 */
function dateOnly(value: string | null): string {
  if (typeof value !== 'string' || value.length < 10) return '时间不明'
  return value.slice(0, 10)
}

export async function pushWhatsappUnclaimedItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const { data, error } = await supabase
    .from('whatsapp_unclaimed_numbers')
    .select('phone_number_id, last_seen_at, last_kind')
    .is('resolved_at', null)
    // The stale filter must run BEFORE the limit: otherwise 50 fresh junk rows could crowd out a real one.
    .gte('last_seen_at', new Date(now.getTime() - STALE_MS).toISOString())
    .order('last_seen_at', { ascending: false })
    .limit(50)

  if (error) {
    // 表还没部署：静默跳过，不当故障（不报 ≠ 没事，但这里确实还没东西可报）。
    if (isMissingTableError(error)) return
    throw new Error('whatsapp unclaimed read failed')
  }

  const rows: UnclaimedRow[] = (data ?? []) as UnclaimedRow[]
  if (rows.length === 0) return

  const ids = rows.map((r) => r.phone_number_id)

  const { data: clientData, error: clientError } = await supabase
    .from('clients')
    .select('whatsapp_phone_number_id')
    .in('whatsapp_phone_number_id', ids)

  if (clientError) {
    throw new Error('whatsapp unclaimed read failed')
  }

  const boundIds = new Set<string>()
  for (const c of (clientData ?? []) as { whatsapp_phone_number_id: string | null }[]) {
    if (typeof c.whatsapp_phone_number_id === 'string' && c.whatsapp_phone_number_id.length > 0) {
      boundIds.add(c.whatsapp_phone_number_id)
    }
  }

  // 已经绑上了的：把登记行标成已解决，不再下发。尽力而为，失败只 warn。
  if (boundIds.size > 0) {
    const { error: resolveError } = await supabase
      .from('whatsapp_unclaimed_numbers')
      .update({ resolved_at: now.toISOString() })
      .in('phone_number_id', Array.from(boundIds))
    if (resolveError) {
      console.warn('whatsapp unclaimed resolve failed')
    }
  }

  const cutoff = now.getTime() - STALE_MS

  for (const row of rows) {
    if (boundIds.has(row.phone_number_id)) continue

    // 太久没动静的就不再每天来烦人（行不删，只是不下发）。
    if (typeof row.last_seen_at === 'string') {
      const seen = Date.parse(row.last_seen_at)
      if (Number.isFinite(seen) && seen < cutoff) continue
    }

    const id = row.phone_number_id
    items.push({
      kind: 'whatsapp_number_unclaimed',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what:
        `有一个 WhatsApp 号码（号码编号 ${id}）在给我们发消息，` +
        `但 ME 里没有任何客户绑定它——它的消息现在没有存下来` +
        `（最近一次：${dateOnly(row.last_seen_at)}）`,
      how:
        `在对应客户的设置页「WhatsApp 号码」里，把号码编号 ${id} 绑上去；` +
        '绑好后下一条消息就会进来；Meta 重投没存下的历史的时间有限（通常只有几天），请尽快绑',
      href: `${APP_BASE}/dashboard/clients`,
    })
  }
}
