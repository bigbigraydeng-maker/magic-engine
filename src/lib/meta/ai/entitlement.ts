import { supabaseAdmin } from '@/lib/supabase'
import { MetaReadError } from '../graph-read'
import { enabled } from './contract'

type PilotStatus = 'active' | 'paused' | 'revoked'

interface PilotRow {
  status: PilotStatus
  starts_at: string
  expires_at: string | null
}

export interface PilotState {
  invited: boolean
  new_actions_allowed: boolean
  reason: 'ready' | 'service_paused' | 'invitation_required' | 'invitation_inactive' | 'invitation_expired'
}

async function entitlement(clientId: string): Promise<PilotRow | null> {
  const { data, error } = await supabaseAdmin
    .from('meta_ads_ai_pilot_entitlements')
    .select('status,starts_at,expires_at')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new MetaReadError('authorization_unavailable', 503)
  return data as PilotRow | null
}

function rowState(row: PilotRow | null, now = Date.now()): PilotState {
  if (!row) return { invited: false, new_actions_allowed: false, reason: 'invitation_required' }
  if (row.status !== 'active' || Date.parse(row.starts_at) > now) {
    return { invited: true, new_actions_allowed: false, reason: 'invitation_inactive' }
  }
  if (row.expires_at && Date.parse(row.expires_at) <= now) {
    return { invited: true, new_actions_allowed: false, reason: 'invitation_expired' }
  }
  if (!enabled()) return { invited: true, new_actions_allowed: false, reason: 'service_paused' }
  return { invited: true, new_actions_allowed: true, reason: 'ready' }
}

export async function pilotState(clientId: string): Promise<PilotState> {
  return rowState(await entitlement(clientId))
}

async function hasLifecycleArtifacts(clientId: string): Promise<boolean> {
  const queries = [
    supabaseAdmin.from('platform_oauth_connections').select('id').eq('client_id', clientId).eq('purpose', 'meta_ads_read').limit(1),
    supabaseAdmin.from('meta_ads_read_grants').select('id').eq('client_id', clientId).limit(1),
    supabaseAdmin.from('client_api_keys').select('id').eq('client_id', clientId).contains('scopes', ['meta:ads:read']).limit(1),
  ]
  const results = await Promise.all(queries)
  if (results.some(result => result.error)) throw new MetaReadError('authorization_unavailable', 503)
  return results.some(result => (result.data?.length ?? 0) > 0)
}

export async function requirePilotLifecycleAccess(clientId: string): Promise<PilotState> {
  const state = await pilotState(clientId)
  if (state.invited || await hasLifecycleArtifacts(clientId)) return state
  throw new MetaReadError('pilot_required', 404)
}

export async function requirePilotActive(clientId: string): Promise<PilotState> {
  const state = await pilotState(clientId)
  if (state.new_actions_allowed) return state
  const status = state.reason === 'service_paused' ? 404 : 403
  throw new MetaReadError(state.reason, status)
}

export async function pilotEntryVisible(clientId: string): Promise<boolean> {
  try {
    await requirePilotLifecycleAccess(clientId)
    return true
  } catch {
    return false
  }
}
