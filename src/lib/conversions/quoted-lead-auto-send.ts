/**
 * 待核对的咨询，客人当前在「已报价」，并且还在广告平台 7 天窗口内：
 * 走现有的批准并发送，不另写一条发给广告平台的路。
 *
 * Ray 2026-11-10 09:28 NZDT：「已报价可以自动回传」。
 * 开关在客户上，默认关。开给谁由数据库里的客户配置决定，这里不写客户编号。
 * 成交（定金 / 尾款）不在这里发。质量列里「曾经到过已报价」的人数也不在这里发。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isPastEventWindow } from './event-window'
import { pastEventWindowCutoffIso } from './review-copy'
import { sendApprovedOutcome, type SendDeps } from './writeback-service'

/** CRM 阶段键。页上写「已报价」。这是客户阶段机用的键，不是某一个客户的事实。 */
export const QUOTED_STAGE_KEY = 'quoted'
export const QUOTED_LEAD_AUTO_SEND_RULE = 'quoted_stage_within_window'
export const QUOTED_LEAD_ACTOR = 'quoted-lead-auto-send@system'

const BATCH_LIMIT = 60

type LeadRow = {
  id: string
  contact_id: string | null
  occurred_at: string
}

export type QuotedLeadAutoSendDeps = {
  supabase: SupabaseClient
  sendDeps: Omit<SendDeps, 'supabase'>
  now?: Date
}

export type QuotedLeadAutoSendResult =
  | { ran: false; reason: 'disabled' }
  | { ran: true; sent: number; leftForHuman: number }

async function flagOn(supabase: SupabaseClient, clientId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('clients')
    .select('quoted_lead_auto_send_enabled')
    .eq('id', clientId)
    .maybeSingle()

  if (error) {
    // 列还没加上时当作关。没打开之前不能发。
    if (/quoted_lead_auto_send_enabled|does not exist|PGRST204|42703/i.test(error.message)) return false
    throw new Error(`读取已报价自动回传开关失败：${error.message}`)
  }
  return (data as { quoted_lead_auto_send_enabled?: boolean } | null)?.quoted_lead_auto_send_enabled === true
}

async function listCandidateLeads(supabase: SupabaseClient, clientId: string, now: Date): Promise<LeadRow[]> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('id, contact_id, occurred_at')
    .eq('client_id', clientId)
    .eq('review_status', 'pending_review')
    .eq('outcome_kind', 'lead')
    .is('redacted_at', null)
    .gte('occurred_at', pastEventWindowCutoffIso(now))
    .order('occurred_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (error) throw new Error(`读取待核对咨询失败：${error.message}`)
  return ((data ?? []) as LeadRow[]).filter((row) => Boolean(row.contact_id))
}

async function quotedContactIds(
  supabase: SupabaseClient,
  clientId: string,
  contactIds: string[],
): Promise<Set<string>> {
  if (contactIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, stage')
    .eq('client_id', clientId)
    .in('id', contactIds)

  if (error) throw new Error(`读取客人阶段失败：${error.message}`)
  const ids = new Set<string>()
  for (const row of (data ?? []) as { id: string; stage: string | null }[]) {
    if (row.stage === QUOTED_STAGE_KEY) ids.add(row.id)
  }
  return ids
}

async function approveLead(
  supabase: SupabaseClient,
  outcomeId: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .update({
      review_status: 'approved',
      reviewed_by: QUOTED_LEAD_ACTOR,
      reviewed_at: now.toISOString(),
      reviewed_ip: null,
      reviewed_ua: null,
      review_request_id: crypto.randomUUID(),
      updated_at: now.toISOString(),
    })
    .eq('id', outcomeId)
    .eq('review_status', 'pending_review')
    .select('id')

  if (error) throw new Error(`批准失败：${error.message}`)
  return (data?.length ?? 0) > 0
}

async function writeAudit(
  supabase: SupabaseClient,
  outcomeId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('me_conversion_audit').insert({
    outcome_id: outcomeId,
    action,
    actor: QUOTED_LEAD_ACTOR,
    detail,
  })
  if (error) console.warn('[quoted-lead-auto-send] 审计没写上:', error.message)
}

export async function runQuotedLeadAutoSendForClient(
  clientId: string,
  deps: QuotedLeadAutoSendDeps,
): Promise<QuotedLeadAutoSendResult> {
  const now = deps.now ?? new Date()
  if (!(await flagOn(deps.supabase, clientId))) return { ran: false, reason: 'disabled' }

  const leads = await listCandidateLeads(deps.supabase, clientId, now)
  const quoted = await quotedContactIds(
    deps.supabase,
    clientId,
    leads.map((row) => row.contact_id).filter((id): id is string => Boolean(id)),
  )

  let sent = 0
  let leftForHuman = 0
  for (const lead of leads) {
    if (!lead.contact_id || !quoted.has(lead.contact_id) || isPastEventWindow(lead.occurred_at, now)) {
      leftForHuman++
      continue
    }
    const approved = await approveLead(deps.supabase, lead.id, now)
    if (!approved) {
      leftForHuman++
      continue
    }
    await writeAudit(deps.supabase, lead.id, 'quoted_lead_auto_approved', {
      rule: QUOTED_LEAD_AUTO_SEND_RULE,
      stage: QUOTED_STAGE_KEY,
      reason: 'crm_stage_quoted',
    })
    try {
      // 不把判断用的 now 传进发送。发送要写真实时间，否则在途的一条会被当成断线。
      const result = await sendApprovedOutcome(lead.id, { supabase: deps.supabase, ...deps.sendDeps })
      await writeAudit(deps.supabase, lead.id, 'sent', {
        rule: QUOTED_LEAD_AUTO_SEND_RULE,
        status: result.status,
      })
      sent++
    } catch (e) {
      await writeAudit(deps.supabase, lead.id, 'quoted_lead_auto_send_failed', {
        rule: QUOTED_LEAD_AUTO_SEND_RULE,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return { ran: true, sent, leftForHuman }
}
