/**
 * 服务级「只暂停」：用服务密钥暂停一条广告系列。
 * 不能恢复、不能改预算、不能删除或新建。总开关默认关。
 * 先写操作记录，记录写不进去就不去改广告。
 * 不点名任何客户。
 */

import { inngest } from '@/lib/inngest/client'
import { assertCampaignOwnedByClient } from '@/lib/meta/campaign-ownership'
import { setCampaignStatus } from '@/lib/meta/client'
import { resolveMetaToken } from '@/lib/meta/token-selection'
import { supabaseAdmin } from '@/lib/supabase'

export const SERVICE_PAUSE_ACTION = 'ads.service_pause_only'
export const SERVICE_PAUSE_EVENT = 'ads.service_pause.completed'

const BODY_KEYS = [
  'client_id', 'campaign_id', 'campaign_name', 'ad_account_id', 'fault_code', 'fault_what',
  'spend_today_cents', 'spend_lifetime_cents', 'currency', 'as_of', 'triggered_by', 'idempotency_key',
] as const

const ALLOWED = new Set<string>(BODY_KEYS)

export interface PauseBody {
  client_id: string
  campaign_id: string
  campaign_name: string
  ad_account_id: string
  fault_code: string
  fault_what: string
  spend_today_cents: number | null
  spend_lifetime_cents: number | null
  currency: string
  as_of: string
  triggered_by: 'ads-tracking-launch-watch'
  idempotency_key: string
}

export interface PauseRow {
  id: string
  payload: Record<string, unknown>
}

export interface OwnedCampaign {
  ok: true
  status: string | null
}

export interface PauseOnlyDeps {
  enabled: boolean
  findByKey: (clientId: string, key: string) => Promise<PauseRow | null | 'error'>
  insert: (clientId: string, payload: Record<string, unknown>) => Promise<{ id: string } | null>
  update: (id: string, payload: Record<string, unknown>) => Promise<boolean>
  resolveToken: (clientId: string) => Promise<string | null>
  assertOwned: (campaignId: string, clientId: string, token: string) => Promise<OwnedCampaign | { ok: false }>
  pauseOnly: (campaignId: string, token: string) => Promise<boolean>
  sendEvent: (event: { id: string; data: { client_id: string; action_id: string } }) => Promise<void>
}

export interface PauseOnlyResult {
  http: number
  body: {
    paused: boolean
    reason: string
    idempotent?: boolean
    warning?: string
    action_id?: string
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function servicePauseEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.ME_SERVICE_PAUSE_ENABLED
  return value === '1' || value === 'true'
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  return trimmed
}

function centsOf(v: unknown): number | null | undefined {
  if (v === null) return null
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  return undefined
}

function invalid(): { ok: false; reason: 'invalid_body' } {
  return { ok: false, reason: 'invalid_body' }
}

/** 只认约定字段。多一个字段就拒绝，避免借这个入口改预算或恢复投放。 */
export function parsePauseBody(raw: unknown): { ok: true; body: PauseBody } | { ok: false; reason: string } {
  if (!isRecord(raw)) return invalid()
  if (Object.keys(raw).some(key => !ALLOWED.has(key))) return { ok: false, reason: 'unexpected_field' }
  const clientId = text(raw.client_id, 80)
  const campaignId = text(raw.campaign_id, 20)
  const name = text(raw.campaign_name, 200)
  const account = text(raw.ad_account_id, 24)
  const faultCode = text(raw.fault_code, 80)
  const faultWhat = text(raw.fault_what, 800)
  const currency = text(raw.currency, 3)
  const asOf = text(raw.as_of, 40)
  const key = text(raw.idempotency_key, 240)
  const today = centsOf(raw.spend_today_cents)
  const lifetime = centsOf(raw.spend_lifetime_cents)
  if (clientId === null || campaignId === null || !/^\d{6,20}$/.test(campaignId)) return invalid()
  if (name === null || account === null || !/^act_\d{6,20}$/.test(account)) return invalid()
  if (faultCode === null || !/^[a-z_+]+$/.test(faultCode) || faultWhat === null) return invalid()
  if (currency === null || !/^[A-Z]{3}$/.test(currency) || asOf === null || Number.isNaN(Date.parse(asOf))) return invalid()
  if (raw.triggered_by !== 'ads-tracking-launch-watch' || key === null) return invalid()
  if (today === undefined || lifetime === undefined) return invalid()
  return {
    ok: true,
    body: {
      client_id: clientId,
      campaign_id: campaignId,
      campaign_name: name,
      ad_account_id: account,
      fault_code: faultCode,
      fault_what: faultWhat,
      spend_today_cents: today,
      spend_lifetime_cents: lifetime,
      currency,
      as_of: asOf,
      triggered_by: 'ads-tracking-launch-watch',
      idempotency_key: key,
    },
  }
}

export function pausePayload(body: PauseBody, status: string): Record<string, unknown> {
  return {
    status,
    idempotency_key: body.idempotency_key,
    campaign_id: body.campaign_id,
    campaign_name: body.campaign_name,
    ad_account_id: body.ad_account_id,
    fault_code: body.fault_code,
    fault_what: body.fault_what,
    spend_today_cents: body.spend_today_cents,
    spend_lifetime_cents: body.spend_lifetime_cents,
    currency: body.currency,
    as_of: body.as_of,
    triggered_by: body.triggered_by,
  }
}

/** 只允许暂停。类型上就没有恢复这个选项。 */
export async function pauseCampaignOnly(
  campaignId: string,
  token: string,
  setStatus: (id: string, accessToken: string, status: 'PAUSED') => Promise<boolean>,
): Promise<boolean> {
  return setStatus(campaignId, token, 'PAUSED')
}

function result(http: number, reason: string, extra: Partial<PauseOnlyResult['body']> = {}): PauseOnlyResult {
  return { http, body: { paused: false, reason, ...extra } }
}

function replay(row: PauseRow): PauseOnlyResult {
  const status = typeof row.payload.status === 'string' ? row.payload.status : 'pending'
  if (status === 'paused') return result(200, 'paused', { paused: true, idempotent: true, action_id: row.id })
  const reason = status === 'already_paused' || status === 'meta_failed' ? status : 'pending'
  return result(200, reason, { idempotent: true, action_id: row.id })
}

async function notify(deps: PauseOnlyDeps, body: PauseBody, actionId: string): Promise<string | null> {
  try {
    await deps.sendEvent({ id: body.idempotency_key, data: { client_id: body.client_id, action_id: actionId } })
    return null
  } catch {
    return 'notify_failed'
  }
}

async function recordWithoutMeta(deps: PauseOnlyDeps, body: PauseBody, status: string, reason: string): Promise<PauseOnlyResult> {
  const row = await deps.insert(body.client_id, pausePayload(body, status))
  if (row === null) return result(200, 'log_failed')
  return result(200, reason, { action_id: row.id })
}

async function pauseNew(deps: PauseOnlyDeps, body: PauseBody, token: string): Promise<PauseOnlyResult> {
  const pending = pausePayload(body, 'pending')
  const row = await deps.insert(body.client_id, pending)
  if (row === null) return result(200, 'log_failed')
  const paused = await deps.pauseOnly(body.campaign_id, token)
  if (!paused) {
    await deps.update(row.id, pausePayload(body, 'meta_failed'))
    return result(200, 'meta_failed', { action_id: row.id })
  }
  const wrote = await deps.update(row.id, pausePayload(body, 'paused'))
  const warning = await notify(deps, body, row.id)
  const note = !wrote ? 'log_update_failed' : warning
  return result(200, 'paused', { paused: true, action_id: row.id, ...(note !== null ? { warning: note } : {}) })
}

/** 总开关关着、或同一把钥匙已经处理过，都不会再去改广告，也不会再发通知。 */
export async function pauseCampaignServiceOnly(raw: unknown, deps: PauseOnlyDeps): Promise<PauseOnlyResult> {
  const parsed = parsePauseBody(raw)
  if (!parsed.ok) return result(422, parsed.reason)
  if (!deps.enabled) return result(200, 'switch_off')
  const existing = await deps.findByKey(parsed.body.client_id, parsed.body.idempotency_key)
  if (existing === 'error') return result(503, 'log_failed')
  if (existing) return replay(existing)
  const token = await deps.resolveToken(parsed.body.client_id)
  if (token === null || token.length === 0) return result(200, 'meta_failed')
  const owned = await deps.assertOwned(parsed.body.campaign_id, parsed.body.client_id, token)
  if (!owned.ok) return result(403, 'not_owned')
  if (owned.status === 'PAUSED') return recordWithoutMeta(deps, parsed.body, 'already_paused', 'already_paused')
  return pauseNew(deps, parsed.body, token)
}

function rowFrom(data: unknown): PauseRow | null {
  if (!isRecord(data) || typeof data.id !== 'string') return null
  return { id: data.id, payload: isRecord(data.payload) ? data.payload : {} }
}

export function realPauseDeps(): PauseOnlyDeps {
  return {
    enabled: servicePauseEnabled(process.env),
    findByKey: findPauseByKey,
    insert: insertPause,
    update: updatePause,
    resolveToken: async clientId => (await resolveMetaToken(supabaseAdmin, clientId, process.env))?.token ?? null,
    assertOwned: async (campaignId, clientId, token) => {
      const owned = await assertCampaignOwnedByClient(campaignId, clientId, token)
      if (!owned.ok) return { ok: false }
      return { ok: true, status: owned.campaign.status }
    },
    pauseOnly: (campaignId, token) => pauseCampaignOnly(campaignId, token, setCampaignStatus),
    sendEvent: async event => {
      await inngest.send({ id: event.id, name: SERVICE_PAUSE_EVENT, data: event.data })
    },
  }
}

async function findPauseByKey(clientId: string, key: string): Promise<PauseRow | null | 'error'> {
  const { data, error } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', SERVICE_PAUSE_ACTION)
    .eq('payload->>idempotency_key', key)
    .order('executed_at', { ascending: false })
    .limit(1)
  if (error) return 'error'
  const first = Array.isArray(data) ? data[0] : null
  return rowFrom(first)
}

async function insertPause(clientId: string, payload: Record<string, unknown>): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id: clientId,
      execution_item_id: null,
      flywheel: 'ads',
      action_type: SERVICE_PAUSE_ACTION,
      execution_mode: 'third_party',
      vendor: 'meta',
      payload,
      expected_metric: null,
    })
    .select('id')
    .single()
  if (error || !data || typeof data.id !== 'string') return null
  return { id: data.id }
}

async function updatePause(id: string, payload: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabaseAdmin.from('flywheel_actions').update({ payload }).eq('id', id)
  return !error
}

export async function handlePauseOnlyRequest(req: Request, deps: PauseOnlyDeps, secret: string | undefined): Promise<Response> {
  if (secret === undefined || secret.length === 0) {
    return Response.json({ paused: false, reason: 'service_key_missing' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ paused: false, reason: 'unauthorized' }, { status: 401 })
  }
  let raw: unknown = null
  try {
    raw = await req.json()
  } catch {
    raw = null
  }
  const out = await pauseCampaignServiceOnly(raw, deps)
  return Response.json(out.body, { status: out.http })
}
