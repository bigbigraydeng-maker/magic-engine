import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import type { InsertOutcome, ProviderEventInput, ProviderEventStore } from './types'
import type { StoredProviderEvent } from './resend-receipt'

// 基于 Supabase 的 ProviderEventStore 实现：把 provider webhook 事件写入 provider_webhook_events 表。
export const supabaseProviderEventStore: ProviderEventStore = {
  async insert(row: ProviderEventInput): Promise<InsertOutcome> {
    // 将领域层的 ProviderEventInput 映射为数据库列名后插入。
    const { error } = await supabaseAdmin.from('provider_webhook_events').insert({
      provider: row.provider,
      account: row.account,
      provider_event_id: row.providerEventId,
      event_type: row.eventType,
      provider_message_id: row.providerMessageId,
      occurred_at: row.occurredAt,
      payload: row.payload,
    })
    // 插入成功。
    if (!error) return 'inserted'
    // 唯一约束冲突（23505）视为重复事件，幂等处理。
    if (error.code === '23505') return 'duplicate'
    // 绝不把 error.message / error.details 带出去：CHECK 违例时 details 含完整行（含邮箱）。只带错误码。
    const code = typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code) ? error.code : 'unknown'
    throw new Error(`provider_webhook_events insert failed: ${code}`)
  },
}

/** One stored event by its key (the consumer's read). A read error throws with its code only; a missing row is null. */
export async function loadStoredProviderEvent(
  db: SupabaseClient,
  key: { provider: 'resend'; account: string; providerEventId: string },
): Promise<StoredProviderEvent | null> {
  const { data, error } = await db
    .from('provider_webhook_events')
    .select('event_type, provider_message_id, occurred_at, payload')
    .eq('provider', key.provider)
    .eq('account', key.account)
    .eq('provider_event_id', key.providerEventId)
    .maybeSingle()
  if (error) {
    const code = typeof error.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(error.code) ? error.code : 'unknown'
    throw new Error(`provider_webhook_events read failed: ${code}`)
  }
  if (data === null) return null
  const row = data as { event_type: string; provider_message_id: string | null; occurred_at: string | null; payload: unknown }
  return { eventType: row.event_type, providerMessageId: row.provider_message_id, occurredAt: row.occurred_at, payload: row.payload }
}
