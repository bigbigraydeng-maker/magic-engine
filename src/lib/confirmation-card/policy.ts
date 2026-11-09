import type { SupabaseClient } from '@supabase/supabase-js'
import { getActivePolicy } from '@/lib/kernel/store'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { ConfirmationCardError } from './errors'

const TTL_SECONDS = 30 * 60

/** Open a require-approval rule only when this client has none yet. Never overwrite. */
export async function ensureConfirmationPolicy(
  sb: SupabaseClient,
  clientId: string,
  updatedBy: string,
  now: Date,
): Promise<void> {
  const existing = await getActivePolicy(sb, clientId, CONFIRMATION_ACTION_KEY, now)
  if (existing) {
    if (existing.mode !== 'require_approval') {
      throw new ConfirmationCardError(
        'rule_blocked',
        '这个客户的确认规则不是「必须有人点」，没有出卡。',
      )
    }
    return
  }
  const { error } = await sb.from('client_automation_policies').insert({
    client_id: clientId,
    action_key: CONFIRMATION_ACTION_KEY,
    mode: 'require_approval',
    policy_version: 1,
    spend_cap_per_run_usd: 0,
    decision_ttl_seconds: TTL_SECONDS,
    effective_from: now.toISOString(),
    effective_to: null,
    updated_by: updatedBy,
  })
  if (!error) return
  const again = await getActivePolicy(sb, clientId, CONFIRMATION_ACTION_KEY, now)
  if (again?.mode === 'require_approval') return
  throw new ConfirmationCardError('rule_blocked', '确认规则没能写上，没有出卡。')
}
