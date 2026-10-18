/**
 * Database access for the YouTube publishing workflow: client channel config,
 * approved factory work orders (read-only), receipts, and one-time grants.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { isValidChannelId } from './oauth'
import type { GateResult } from './gates'

export type ReceiptStage = 'staging' | 'public_step'
export type ReceiptStatus = 'pending' | 'blocked' | 'staged' | 'dry_run_ok' | 'published' | 'failed'

export interface ReceiptRow {
  requestId: string
  clientId: string
  channelId: string
  stage: ReceiptStage
  status: ReceiptStatus
  reason?: string
  workOrderId?: string
  videoId?: string
  noPublish: boolean
  authorizationNonce?: string
  authorizedBy?: string
  detail?: Record<string, unknown>
}

export interface ApprovedWorkOrder {
  id: string
  videoUrl: string
  title: string
  description: string
}

export async function getClientChannelId(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('youtube_channel_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw error
  const value = (data as { youtube_channel_id?: string | null } | null)?.youtube_channel_id
  return isValidChannelId(value) ? value : null
}

/** Factory output only: an approved work order of this client with an https video. Read-only. */
export async function getApprovedWorkOrder(
  clientId: string,
  workOrderId: string,
): Promise<ApprovedWorkOrder | null> {
  const { data, error } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, status, angle, output')
    .eq('id', workOrderId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw error
  if (!data || (data as { status: string }).status !== 'approved') return null
  const row = data as { id: string; angle: string; output: Record<string, unknown> | null }
  const url = row.output?.['video_path']
  if (typeof url !== 'string' || !url.startsWith('https://')) return null
  const caption = typeof row.output?.['caption'] === 'string' ? (row.output['caption'] as string) : ''
  return { id: row.id, videoUrl: url, title: row.angle.slice(0, 100), description: caption }
}

export async function insertReceipt(r: ReceiptRow): Promise<void> {
  const { error } = await supabaseAdmin.from('youtube_publish_receipts').insert({
    request_id: r.requestId,
    client_id: r.clientId,
    channel_id: r.channelId,
    stage: r.stage,
    status: r.status,
    reason: r.reason ?? null,
    work_order_id: r.workOrderId ?? null,
    video_id: r.videoId ?? null,
    no_publish: r.noPublish,
    authorization_nonce: r.authorizationNonce ?? null,
    authorized_by: r.authorizedBy ?? null,
    detail: r.detail ?? {},
  })
  if (error) throw error
}

export async function findStagedReceipt(
  clientId: string,
  match: { workOrderId: string } | { videoId: string },
): Promise<{ videoId: string; channelId: string; gates: GateResult[] } | null> {
  let q = supabaseAdmin
    .from('youtube_publish_receipts')
    .select('video_id, channel_id, detail')
    .eq('client_id', clientId)
    .eq('stage', 'staging')
    .eq('status', 'staged')
  q = 'workOrderId' in match ? q.eq('work_order_id', match.workOrderId) : q.eq('video_id', match.videoId)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as { video_id: string; channel_id: string; detail: { gates?: GateResult[] } | null }
  return { videoId: row.video_id, channelId: row.channel_id, gates: row.detail?.gates ?? [] }
}

/** True if staging for this work order has started (pending) or finished (staged): never upload twice. */
export async function hasStagingAttempt(clientId: string, workOrderId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('youtube_publish_receipts')
    .select('id')
    .eq('client_id', clientId)
    .eq('work_order_id', workOrderId)
    .eq('stage', 'staging')
    .in('status', ['pending', 'staged'])
    .limit(1)
  if (error) throw error
  return (data ?? []).length > 0
}

export async function insertAuthorization(a: {
  nonce: string
  clientId: string
  channelId: string
  videoId: string
  grantedBy: string
  grantedAt: string
}): Promise<void> {
  const { error } = await supabaseAdmin.from('youtube_publish_authorizations').insert({
    nonce: a.nonce,
    client_id: a.clientId,
    channel_id: a.channelId,
    video_id: a.videoId,
    granted_by: a.grantedBy,
    granted_at: a.grantedAt,
  })
  if (error) throw error
}

/** Atomic one-time consume: returns the grant only for the first caller. */
export async function consumeAuthorization(
  nonce: string,
  clientId: string,
): Promise<{ clientId: string; channelId: string; videoId: string; grantedBy: string; grantedAt: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('youtube_publish_authorizations')
    .update({ consumed_at: new Date().toISOString() })
    .eq('nonce', nonce)
    .eq('client_id', clientId)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('client_id, channel_id, video_id, granted_by, granted_at')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as { client_id: string; channel_id: string; video_id: string; granted_by: string; granted_at: string }
  return { clientId: r.client_id, channelId: r.channel_id, videoId: r.video_id, grantedBy: r.granted_by, grantedAt: r.granted_at }
}
