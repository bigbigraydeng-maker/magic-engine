/**
 * 线索阶段回传——读写编排（2026-11-10）。
 *
 * 每天由 `conversion-daily-pipeline` 调：
 *   1. 找出开了 `leads_config.crm_stage_signals.enabled` 的客户（不写死任何客户）；
 *   2. 读过去 7 天的阶段变化 + 新进来的即时表单线索 → `planLeadStageEvents` 算出该报的档；
 *   3. 每档写一条 `me_sale_outcomes`（outcome_kind='lead_stage'，自动批准，幂等键防重复）；
 *   4. 逐条交给 `sendApprovedOutcome` 发——防双发、拒联检查、7 天窗口、试运行、
 *      允许种类闸全部沿用那边，这里不另写一套。
 *
 * 🔴 自动批准不等于跳过闸：这一路的「批准」只代表「规则判定这条线索确实到了这一档」。
 *    能不能真发由 `sendApprovedOutcome` 决定——客户没开、试运行、客人说过别联系、
 *    超 7 天，都不会发。
 *
 * 🔴 一次调用最多发 `maxSends` 条，没发完返回 `done:false`，流水线用下一个 step 接着跑——
 *    单步不许逼近网关 ~125 秒硬上限（PITFALLS F8/F10）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeEmail, normalizePhone } from '@/lib/pii/normalize'
import { DAY_MS } from './event-window'
import {
  parseCrmStageSignalsConfig,
  planLeadStageEvents,
  type FormLead,
  type StageChange,
  type PlannedLeadStageEvent,
} from './crm-stage-signals'
import { sendApprovedOutcome, type SendDeps } from './writeback-service'

export const CRM_STAGE_SOURCE_KIND = 'crm_stage_auto'
export const CRM_STAGE_REVIEWER = 'auto:crm-stage-signal'
/** 比平台的 7 天少 1 小时：留出排队与发送的时间，免得刚写进去就过期。 */
export const CRM_STAGE_WINDOW_MS = 7 * DAY_MS - 60 * 60_000
export const CRM_STAGE_DEFAULT_MAX_SENDS = 25
const IN_CHUNK = 100

/** 发送记录已经落到这些状态的，不再交给发送口（省查询；发送口本身也幂等）。 */
const SETTLED = new Set(['confirmed', 'failed_permanent', 'expired_no_send', 'redacted', 'dry_run', 'in_doubt'])

export type CrmStageClientSummary =
  | { ran: false; reason: 'not_enabled' | 'config_invalid' }
  | {
      ran: true
      mode: 'dry_run' | 'live'
      planned: number
      inserted: number
      alreadyExisted: number
      skippedNoMatchKey: number
      skippedStageBeforeLead: number
      sendStatuses: Record<string, number>
      /** 还有没轮到发的，下一块接着发。 */
      remaining: number
    }

export type CrmStageRunDeps = {
  supabase: SupabaseClient
  sendDeps: Omit<SendDeps, 'supabase' | 'now'>
  /** 只用于「过去 7 天」的判断。发送用真实时间（见 conversion-daily-pipeline 文件头）。 */
  now: Date
}

async function inChunks<T>(ids: string[], fn: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await fn(ids.slice(i, i + IN_CHUNK))))
  return out
}

/** 读出某客户在时间窗内该报的档（只读，不写）。 */
export async function loadPlan(
  supabase: SupabaseClient,
  clientId: string,
  cfg: NonNullable<ReturnType<typeof parseCrmStageSignalsConfig>>,
  now: Date,
) {
  const sinceIso = new Date(now.getTime() - CRM_STAGE_WINDOW_MS).toISOString()
  const stageKeys = [...new Set(cfg.stages.flatMap((s) => s.stageKeys))]

  // 窗口内有动静的客人：阶段变到配置里的档，或（要报第一档时）新进来的表单线索
  const recentChanges = await supabase
    .from('contact_stage_events')
    .select('contact_id')
    .eq('client_id', clientId)
    .in('to_stage', stageKeys)
    .gte('created_at', sinceIso)
  if (recentChanges.error) throw new Error(`读取阶段变化失败：${recentChanges.error.message}`)
  const ids = new Set(((recentChanges.data ?? []) as { contact_id: string }[]).map((r) => r.contact_id))

  if (cfg.initialEventName) {
    const recentLeads = await supabase
      .from('contact_touchpoints')
      .select('contact_id')
      .eq('client_id', clientId)
      .eq('source', 'meta_lead_form')
      .gte('occurred_at', sinceIso)
    if (recentLeads.error) throw new Error(`读取表单线索失败：${recentLeads.error.message}`)
    for (const r of (recentLeads.data ?? []) as { contact_id: string | null }[]) if (r.contact_id) ids.add(r.contact_id)
  }

  const contactIds = [...ids]
  if (contactIds.length === 0) return { plan: { events: [], skipped: [] }, contacts: new Map<string, ContactKeys>() }

  // 这些客人的全部历史（判断「最早什么时候到过这一档」要看全）
  const changes = await inChunks(contactIds, async (part) => {
    const r = await supabase
      .from('contact_stage_events')
      .select('contact_id, to_stage, created_at')
      .eq('client_id', clientId)
      .in('contact_id', part)
      .in('to_stage', stageKeys)
    if (r.error) throw new Error(`读取阶段历史失败：${r.error.message}`)
    return ((r.data ?? []) as { contact_id: string; to_stage: string; created_at: string }[]).map(
      (x): StageChange => ({ contactId: x.contact_id, toStage: x.to_stage, at: x.created_at }),
    )
  })
  const leads = await inChunks(contactIds, async (part) => {
    const r = await supabase
      .from('contact_touchpoints')
      .select('contact_id, source_ref, occurred_at')
      .eq('client_id', clientId)
      .eq('source', 'meta_lead_form')
      .in('contact_id', part)
    if (r.error) throw new Error(`读取表单线索失败：${r.error.message}`)
    return ((r.data ?? []) as { contact_id: string; source_ref: string | null; occurred_at: string }[])
      .filter((x) => x.source_ref)
      .map((x): FormLead => ({ contactId: x.contact_id, leadId: x.source_ref as string, createdAt: x.occurred_at }))
  })
  const contactRows = await inChunks(contactIds, async (part) => {
    const r = await supabase.from('contacts').select('id, primary_email, primary_phone').eq('client_id', clientId).in('id', part)
    if (r.error) throw new Error(`读取联系人失败：${r.error.message}`)
    return (r.data ?? []) as { id: string; primary_email: string | null; primary_phone: string | null }[]
  })
  const contacts = new Map<string, ContactKeys>(contactRows.map((c) => [c.id, { email: c.primary_email, phone: c.primary_phone }]))

  const plan = planLeadStageEvents({ config: cfg, leads, changes, now, windowMs: CRM_STAGE_WINDOW_MS })
  return { plan, contacts }
}

type ContactKeys = { email: string | null; phone: string | null }

async function insertPlanned(
  supabase: SupabaseClient,
  clientId: string,
  defaultPhoneCountry: string | null,
  ev: PlannedLeadStageEvent,
  keys: ContactKeys | undefined,
  nowIso: string,
): Promise<'inserted' | 'exists' | 'no_match_key'> {
  const email = normalizeEmail(keys?.email)
  const phone = normalizePhone(keys?.phone, defaultPhoneCountry)
  if (!email && !phone) return 'no_match_key'
  const { error } = await supabase.from('me_sale_outcomes').insert({
    client_id: clientId,
    contact_id: ev.contactId,
    outcome_kind: 'lead_stage',
    lead_stage: ev.eventName,
    meta_lead_id: ev.leadId,
    customer_email: email,
    customer_phone: phone,
    occurred_at: ev.occurredAt,
    source_kind: CRM_STAGE_SOURCE_KIND,
    source_ref: ev.sourceRef,
    review_status: 'approved',
    reviewed_by: CRM_STAGE_REVIEWER,
    reviewed_at: nowIso,
    created_by: CRM_STAGE_REVIEWER,
  })
  if (!error) return 'inserted'
  // 幂等键冲突 = 之前的运行已经写过这一档，正常。认错误码不认文案。
  if ((error as { code?: string }).code === '23505') return 'exists'
  throw new Error(`写入线索阶段记录失败：${error.message}`)
}

/** 时间窗内本客户还没落定的线索阶段记录（按发生时间先后，前面的档先发）。 */
async function pendingToSend(supabase: SupabaseClient, clientId: string, now: Date): Promise<string[]> {
  const sinceIso = new Date(now.getTime() - CRM_STAGE_WINDOW_MS).toISOString()
  const r = await supabase
    .from('me_sale_outcomes')
    .select('id, me_conversion_writebacks(status)')
    .eq('client_id', clientId)
    .eq('outcome_kind', 'lead_stage')
    .eq('source_kind', CRM_STAGE_SOURCE_KIND)
    .eq('review_status', 'approved')
    .is('redacted_at', null)
    .gte('occurred_at', sinceIso)
    .order('occurred_at', { ascending: true })
  if (r.error) throw new Error(`读取待发线索阶段记录失败：${r.error.message}`)
  return ((r.data ?? []) as { id: string; me_conversion_writebacks: { status: string }[] | null }[])
    .filter((row) => !(row.me_conversion_writebacks ?? []).some((w) => SETTLED.has(w.status)))
    .map((row) => row.id)
}

export async function runCrmStageSignalsForClient(
  clientId: string,
  deps: CrmStageRunDeps,
  opts: { maxSends?: number } = {},
): Promise<CrmStageClientSummary> {
  const { supabase, now } = deps
  const clientRes = await supabase.from('clients').select('id, default_phone_country, leads_config').eq('id', clientId).maybeSingle()
  if (clientRes.error) throw new Error(`读取客户配置失败：${clientRes.error.message}`)
  const client = clientRes.data as { default_phone_country: string | null; leads_config: unknown } | null
  if (!client) throw new Error('客户不存在')

  const hasKey = typeof client.leads_config === 'object' && client.leads_config !== null && 'crm_stage_signals' in client.leads_config
  const cfg = parseCrmStageSignalsConfig(client.leads_config)
  if (!cfg) return { ran: false, reason: hasKey ? 'config_invalid' : 'not_enabled' }
  if (!cfg.enabled) return { ran: false, reason: 'not_enabled' }

  const { plan, contacts } = await loadPlan(supabase, clientId, cfg, now)
  const nowIso = now.toISOString()
  let inserted = 0
  let alreadyExisted = 0
  let skippedNoMatchKey = 0
  for (const ev of plan.events) {
    const r = await insertPlanned(supabase, clientId, client.default_phone_country, ev, contacts.get(ev.contactId), nowIso)
    if (r === 'inserted') inserted++
    else if (r === 'exists') alreadyExisted++
    else skippedNoMatchKey++
  }

  const toSend = await pendingToSend(supabase, clientId, now)
  const maxSends = opts.maxSends ?? CRM_STAGE_DEFAULT_MAX_SENDS
  const sendStatuses: Record<string, number> = {}
  for (const id of toSend.slice(0, maxSends)) {
    // 不传 now：发送口用真实时间写尝试时刻（见 conversion-daily-pipeline 文件头「now 只给判断用」）。
    const res = await sendApprovedOutcome(id, { supabase, ...deps.sendDeps })
    sendStatuses[res.status] = (sendStatuses[res.status] ?? 0) + 1
  }

  return {
    ran: true,
    mode: cfg.mode,
    planned: plan.events.length,
    inserted,
    alreadyExisted,
    skippedNoMatchKey,
    skippedStageBeforeLead: plan.skipped.length,
    sendStatuses,
    remaining: Math.max(0, toSend.length - maxSends),
  }
}

/** 开了线索阶段回传的客户名单——来自配置，不写死。 */
export async function crmStageEnabledClientIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .filter('leads_config->crm_stage_signals->>enabled', 'eq', 'true')
  if (error) throw new Error(`读取已开启线索阶段回传的客户失败：${error.message}`)
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}
