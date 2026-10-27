import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientKind, PrescriptionIntake } from '@/types/diagnostic'
import { readClientKind, readWeeklyShootCount } from './personal-ip'

/** clients.client_kind；读不到、空值都按普通客户。 */
export async function loadClientKind(supabase: SupabaseClient, clientId: string): Promise<ClientKind> {
  const { data } = await supabase
    .from('clients')
    .select('client_kind')
    .eq('id', clientId)
    .maybeSingle<{ client_kind: string | null }>()
  return readClientKind(data?.client_kind)
}

/**
 * 开方请求里明确写了客户类型（对话里说了「按普通客户开」）就照请求，
 * 没写就用资料里的客户类型。每周拍几条只在个人 IP 时保留。
 */
export async function resolveIntakeClientKind(
  supabase: SupabaseClient,
  clientId: string,
  intake: PrescriptionIntake,
): Promise<PrescriptionIntake> {
  const requested = intake.client_kind
  const kind: ClientKind = requested === 'standard' || requested === 'personal_ip'
    ? requested
    : await loadClientKind(supabase, clientId)
  const { weekly_shoot_count: requestedShoot, ...rest } = intake
  if (kind !== 'personal_ip') return { ...rest, client_kind: 'standard' }
  return { ...rest, client_kind: kind, weekly_shoot_count: readWeeklyShootCount(requestedShoot) }
}
