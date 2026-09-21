import { supabaseAdmin } from '@/lib/supabase'
import { MetaReadError } from '../graph-read'
import { enabled } from './contract'

type PilotStatus = 'active' | 'paused' | 'revoked'

interface PilotRow {
  status: PilotStatus
  starts_at: string
  expires_at: string | null
  revision: string
  sponsored_analysis_enabled: boolean
}

export interface PilotState {
  invited: boolean
  new_actions_allowed: boolean
  reason: 'ready' | 'service_paused' | 'invitation_required' | 'invitation_inactive' | 'invitation_expired'
  revision: string | null
  sponsored_analysis_enabled: boolean
}

async function entitlement(clientId: string): Promise<PilotRow | null> {
  const { data, error } = await supabaseAdmin
    .from('meta_ads_ai_pilot_entitlements')
    .select('status,starts_at,expires_at,revision,sponsored_analysis_enabled')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new MetaReadError('authorization_unavailable', 503)
  return data as PilotRow | null
}

function rowState(row: PilotRow | null, now = Date.now()): PilotState {
  if (!row) return { invited: false, new_actions_allowed: false, reason: 'invitation_required', revision:null, sponsored_analysis_enabled:false }
  const sponsoredAnalysisEnabled=Boolean(row.sponsored_analysis_enabled)
  if (row.status !== 'active' || Date.parse(row.starts_at) > now) {
    return { invited: true, new_actions_allowed: false, reason: 'invitation_inactive',revision:row.revision,sponsored_analysis_enabled:sponsoredAnalysisEnabled }
  }
  if (row.expires_at && Date.parse(row.expires_at) <= now) {
    return { invited: true, new_actions_allowed: false, reason: 'invitation_expired',revision:row.revision,sponsored_analysis_enabled:sponsoredAnalysisEnabled }
  }
  if (!enabled()) return { invited: true, new_actions_allowed: false, reason: 'service_paused',revision:row.revision,sponsored_analysis_enabled:sponsoredAnalysisEnabled }
  return { invited: true, new_actions_allowed: true, reason: 'ready',revision:row.revision,sponsored_analysis_enabled:sponsoredAnalysisEnabled }
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

export async function requirePilotRevision(clientId:string,revision:string):Promise<PilotState> {
  const state=await requirePilotActive(clientId)
  if(state.revision!==revision) throw new MetaReadError('invitation_changed',403)
  return state
}

export async function pilotEntryVisible(clientId: string): Promise<boolean> {
  try {
    await requirePilotLifecycleAccess(clientId)
    return true
  } catch {
    return false
  }
}
