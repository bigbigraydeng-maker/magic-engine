/**
 * The only go-live path that may write an ad from paused to live.
 * Call it only after the confirmation card is confirmed. Tests mock the network.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SpendActivationAuthority } from '@/lib/ads/spend-activation'
import type { ExecutionOutcome, SettleResult } from '@/lib/ads-go-live'
import { settleGoLive, type ActivateAttempt, type LayerRead } from '@/lib/ads-go-live'
import type { GoLiveIds } from '@/lib/ads-go-live/draft'
import { approveDraft } from '@/lib/ads-strategy/draft-and-gate'
import { activatePublished, pausePublished } from '@/lib/meta/ad-publisher'
import { fetchCampaignStatus } from '@/lib/meta/readback'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'

function held(reason: string): ExecutionOutcome {
  return {
    settle: { outcome: 'held', readback: '没有读取广告状态', reason, paused: false },
    note: null,
  }
}

function fromWrite(result: { ok: true } | { ok: false; error: string; holding?: boolean }): ActivateAttempt {
  if (result.ok) return { ok: true, retryable: true, holding: false }
  return {
    ok: false,
    error: result.error,
    retryable: result.error.startsWith('开 '),
    holding: result.holding === true,
  }
}

async function ownsGoLive(
  sb: SupabaseClient,
  clientId: string,
  draftId: string,
  cardRunId: string,
): Promise<boolean> {
  const current = await readPayload(sb, clientId, draftId)
  if (!current) return false
  const status = typeof current.status === 'string' ? current.status : ''
  if (status !== 'activating' && status !== 'active') return false
  return activationRunId(current) === cardRunId
}

function targets(ids: GoLiveIds): { name: string; id: string }[] {
  const ads = ids.adIds.map((id, index) => ({
    name: ids.adIds.length === 1 ? '广告' : `第${index + 1}条广告`,
    id,
  }))
  return [...ads, { name: '广告组', id: ids.adSetId }, { name: '广告系列', id: ids.campaignId }]
}

async function readLayers(ids: GoLiveIds, token: string): Promise<LayerRead[] | null> {
  try {
    return await Promise.all(targets(ids).map(async (target) => ({
      name: target.name,
      status: await fetchCampaignStatus(target.id, token),
    })))
  } catch {
    return null
  }
}

function missed(settled: SettleResult): string {
  return settled.outcome === 'live'
    ? '开投观察的开始时间没写上。'
    : '账本没写上，请到广告审批页核对这条草稿。'
}

function activationRunId(payload: Record<string, unknown>): string | null {
  const activation = payload.activation
  if (!activation || typeof activation !== 'object' || Array.isArray(activation)) return null
  const id = (activation as { card_run_id?: unknown }).card_run_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * An activate-only retry skips approveDraft, so a failed receipt would stay meta_failed.
 * writeMark applies this only while this card run still owns the row.
 */
function executedActivation(current: Record<string, unknown>): Record<string, unknown> {
  const activation = current.activation
  if (!activation || typeof activation !== 'object' || Array.isArray(activation)) return current
  const row = activation as Record<string, unknown>
  if (row.status === 'executed' && row.error === undefined) return current
  const next: Record<string, unknown> = { ...row, status: 'executed' }
  delete next.error
  return { ...current, activation: next }
}

function nextPayload(current: Record<string, unknown>, settled: SettleResult, at: string): Record<string, unknown> | null {
  if (settled.outcome === 'live') {
    const source = settled.attempts === 2 ? executedActivation(current) : current
    const rest = { ...source }
    delete rest.error
    delete rest.goLiveHeld
    return { ...rest, status: 'active', goLiveStartedAt: at }
  }
  if (!settled.paused && current.status !== 'awaiting_approval') return null
  return { ...current, status: 'awaiting_approval', error: settled.reason, goLiveHeld: settled.reason }
}

async function readPayload(sb: SupabaseClient, clientId: string, draftId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await sb
    .from('flywheel_actions')
    .select('payload')
    .eq('id', draftId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data || typeof data !== 'object') return null
  const payload = (data as { payload?: unknown }).payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  return { ...(payload as Record<string, unknown>) }
}

async function writeMark(
  sb: SupabaseClient,
  clientId: string,
  draftId: string,
  settled: SettleResult,
  at: string,
  cardRunId: string,
): Promise<string | null> {
  const current = await readPayload(sb, clientId, draftId)
  const status = typeof current?.status === 'string' ? current.status : ''
  if (!current || !status || activationRunId(current) !== cardRunId) return missed(settled)
  const next = nextPayload(current, settled, at)
  if (!next) return null
  const updated = await sb
    .from('flywheel_actions')
    .update({ payload: next })
    .eq('id', draftId)
    .eq('client_id', clientId)
    .eq('payload->>status', status)
    .eq('payload->activation->>card_run_id', cardRunId)
    .select('id')
  const rows = Array.isArray(updated.data) ? updated.data.length : 0
  if (updated.error || rows !== 1) return missed(settled)
  return null
}

async function runSettle(
  args: { supabase: SupabaseClient; clientId: string; draftId: string; authority: SpendActivationAuthority; ids: GoLiveIds },
  token: string,
): Promise<SettleResult> {
  const ids = { campaignId: args.ids.campaignId, adSetId: args.ids.adSetId, adIds: [...args.ids.adIds] }
  const stillOwns = () => ownsGoLive(args.supabase, args.clientId, args.draftId, args.authority.cardRunId ?? '')
  const ports = {
    claimAndActivate: async () => fromWrite(await approveDraft(
      args.draftId, args.supabase, token, args.authority, 'go-live-card',
    )),
    activateOnly: async () => fromWrite(await activatePublished(ids, token)),
    readBack: () => readLayers(args.ids, token),
    stillOwns,
    keepPaused: () => pausePublished(ids, token),
  }
  try {
    return await settleGoLive(ports)
  } catch {
    let paused = false
    try {
      if (await stillOwns()) {
        await ports.keepPaused()
        paused = true
      }
    } catch { /* still held */ }
    return {
      outcome: 'held',
      readback: '读回失败，不知道是不是在投',
      reason: '开投没有完成，系列尽量保持暂停。',
      paused,
    }
  }
}

function allowed(authority: SpendActivationAuthority): boolean {
  return authority.basis === 'go_live_card' && authority.actorEmail.trim().length > 0 && !!authority.cardRunId
}

export async function executeConfirmedGoLive(args: {
  supabase: SupabaseClient
  clientId: string
  draftId: string
  authority: SpendActivationAuthority
  ids: GoLiveIds | null
  now?: Date
}): Promise<ExecutionOutcome> {
  const ids = args.ids
  if (!ids) return held('没记下广告编号，没有开，系列保持暂停。')
  if (!allowed(args.authority)) return held('这次确认对不上，没有开，系列保持暂停。')
  const token = await getMetaTokenForClient(args.clientId)
  if (!token) return held('拿不到这个客户的广告授权，没有开，系列保持暂停。')
  const settled = await runSettle({ ...args, ids }, token)
  const note = await writeMark(
    args.supabase,
    args.clientId,
    args.draftId,
    settled,
    (args.now ?? new Date()).toISOString(),
    args.authority.cardRunId ?? '',
  )
  return { settle: settled, note }
}
