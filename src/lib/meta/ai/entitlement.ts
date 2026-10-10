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
  source: 'ops' | 'self_serve'
}

export interface PilotState {
  invited: boolean
  new_actions_allowed: boolean
  reason: 'ready' | 'service_paused' | 'invitation_required' | 'invitation_inactive' | 'invitation_expired'
  revision: string | null
  sponsored_analysis_enabled: boolean
  /** 'ops' = opened by us (and allowed to connect Facebook while Meta review is pending); 'self_serve' = opened by the customer */
  source: 'ops' | 'self_serve' | null
}

async function entitlement(clientId: string): Promise<PilotRow | null> {
  const { data, error } = await supabaseAdmin
    .from('meta_ads_ai_pilot_entitlements')
    .select('status,starts_at,expires_at,revision,sponsored_analysis_enabled,source')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new MetaReadError('authorization_unavailable', 503)
  return data as PilotRow | null
}

function rowState(row: PilotRow | null, now = Date.now()): PilotState {
  if (!row) return { invited: false, new_actions_allowed: false, reason: 'invitation_required', revision:null, sponsored_analysis_enabled:false, source:null }
  const sponsoredAnalysisEnabled=Boolean(row.sponsored_analysis_enabled)
  const source=row.source === 'self_serve' ? 'self_serve' : 'ops'
  if (row.status !== 'active' || Date.parse(row.starts_at) > now) {
    return { invited: true, new_actions_allowed: false, reason: 'invitation_inactive',revision:row.revision,sponsored_analysis_enabled:sponsoredAnalysisEnabled,source }
  }
  if (row.expires_at && Date.parse(row.expires_at) <= now) {
    return { invited: true, new_actions_allowed: false, reason: 'invitation_expired',revision:row.revision,sponsored_analysis_enabled:sponsoredAnalysisEnabled,source }
  }
  if (!enabled()) return { invited: true, new_actions_allowed: false, reason: 'service_paused',revision:row.revision,sponsored_analysis_enabled:sponsoredAnalysisEnabled,source }
  return { invited: true, new_actions_allowed: true, reason: 'ready',revision:row.revision,sponsored_analysis_enabled:sponsoredAnalysisEnabled,source }
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
    // Self-serve clients see the entry even before opening it — the page offers the free activation.
    return isSelfServeClient(clientId).catch(() => false)
  }
}

/** Registered through /portal/register (clients.source = 'self_serve'). */
export async function isSelfServeClient(clientId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('clients').select('source').eq('id', clientId).maybeSingle()
  if (error) throw new MetaReadError('authorization_unavailable', 503)
  return (data as { source?: string } | null)?.source === 'self_serve'
}

/** Flipped on once Meta grants ads_read advanced access; until then only 'ops' clients (testers) may connect Facebook. */
export function publicConnectOpen(): boolean {
  return process.env.META_ADS_AI_PUBLIC_CONNECT === 'true'
}

export function requireConnectAllowed(state: PilotState): void {
  if (!publicConnectOpen() && state.source !== 'ops') throw new MetaReadError('connect_waiting_review', 403)
}

export type ActivationResult = 'activated' | 'renewed' | 'already_active'

/** A self-serve member opens (or, once expired, renews) their own client's free 90-day access. */
export async function selfServeActivate(clientId: string, memberEmail: string): Promise<ActivationResult> {
  const { data, error } = await supabaseAdmin.rpc('meta_ads_self_serve_activate', { tenant: clientId, member_email: memberEmail })
  if (error) throw new MetaReadError('authorization_unavailable', 503)
  const result = data as { ok?: boolean; result?: string } | null
  if (!result?.ok) throw new MetaReadError('activation_not_allowed', 403)
  if (result.result === 'activated' || result.result === 'renewed' || result.result === 'already_active') return result.result
  throw new MetaReadError('authorization_unavailable', 503)
}
