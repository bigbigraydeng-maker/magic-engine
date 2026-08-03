/**
 * 把打过的电话变成 CRM 里的一条记录。
 *
 * ## 为什么之前没有这一层（2026-08-03 查出来的）
 *
 * 语音那套已经能打电话、能转写、能出摘要，全部存在 `voice_*` 那十几张表里。
 * 但 `src/lib/voice/` 整个目录里，`contact_touchpoints` 一次都没出现过 ——
 * **电话打完了，CRM 一个字都看不到。**
 *
 * 后果不是「少了个记录」，是分批规则会说假话：
 *   · 打通了聊了十分钟的人，在看板上仍然是「新客人，还没人联系过」
 *   · 客人在电话里说「别再打了」，第二天他照样出现在今天的名单上
 *   · 销售看到「上次联系 40 天前」，而实际上 AI 昨天刚跟他通过话
 *
 * PM 2026-08-03 把口径定成「以各渠道**真实对话内容**为准 —— 邮件、Messenger、
 * 以后的 WhatsApp、**IP 电话**、短信」。电话这一条在此之前是零。
 *
 * ## 三条判断
 *
 * **① 演练电话绝不进 CRM。** `is_simulated` 的通话是我们自己在测系统，把它
 * 写进客户的 CRM 等于往真人名单里掺假数据 —— 而且是查不出来的那种假。
 *
 * **② 客人自己打进来的才建人，我们打出去的只挂已有的人。** 跟邮件那边同一条
 * 护栏：一通打给陌生号码的外呼不该在 CRM 里凭空生出一个「客人」。挂不上就
 * 如实报数（`skippedNoContact`），不静悄悄地丢。
 *
 * **③ 通话结果要翻译成 CRM 认识的词，而且不能翻错。** `wrong_number` 必须变成
 * `bad_number`（那会让这个人进「号码要修」），`not_interested` 必须变成
 * `not_interested`（那会把他移出名单）。翻错一个，要么该联系的人消失，
 * 要么说过别打的人被继续打 —— 后者是合规问题。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { normalisePhone, resolveContact } from '@/lib/crm/identity'
import type { ContactOutcome } from '@/lib/crm/note-parser'
import type { CallOutcome } from './domain'

/** 这条记录从哪来 —— 幂等键的一半，也是将来回查的凭据。 */
export const VOICE_TOUCHPOINT_SOURCE = 'voice_agent'

/** 桥接用得上的通话字段。刻意只收这些，不整行传 —— 纯函数才好测。 */
export interface BridgeableCall {
  id: string
  direction: 'inbound' | 'outbound'
  is_simulated: boolean
  from_number: string | null
  to_number: string | null
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  outcome: string | null
  summary: string | null
}

/**
 * 电话那头是谁的号码。
 *
 * 打进来 = 对方是主叫；打出去 = 对方是被叫。跟邮件那边判「谁是对方」同一个道理：
 * 方向决定，不靠猜 —— 猜错会把客户的记录挂到我们自己的号码上。
 */
export function counterpartyNumber(call: Pick<BridgeableCall, 'direction' | 'from_number' | 'to_number'>): string | null {
  return call.direction === 'inbound' ? call.from_number : call.to_number
}

/**
 * 通话结果 → CRM 认识的那套词。
 *
 * 对应关系不是随便映的，每一条都会改变这个人明天出不出现在名单上：
 *   wrong_number    → bad_number      进「号码要修」，等人补一个对的
 *   not_interested  → not_interested  移出今天的名单（DEAD_OUTCOMES）
 *   failed          → no_answer       没接通，三天内还会让人再试
 *   其余（聊上了）   → spoke           算真的联系过
 *
 * 认不出来的结果一律 `unknown` —— 不猜。猜成 `spoke` 会让一通根本没打通的
 * 电话把人踢出「还没搭上话」，那个人从此没人再碰。
 */
export function callOutcomeToCrm(outcome: string | null, answered: boolean): ContactOutcome {
  // 压根没接通 —— 无论摘要写了什么，都不能算「聊过了」。
  if (!answered) return outcome === 'wrong_number' ? 'bad_number' : 'no_answer'

  switch (outcome as CallOutcome | null) {
    case 'wrong_number':
      return 'bad_number'
    case 'not_interested':
      return 'not_interested'
    case 'failed':
      return 'no_answer'
    case 'resolved':
    case 'qualified':
    case 'appointment_requested':
    case 'transferred':
    case 'follow_up_required':
      return 'spoke'
    default:
      return 'unknown'
  }
}

/** 接通了没有。有通话时长就是接通了；没有就看它有没有 ended_at 之外的证据。 */
export function wasAnswered(call: Pick<BridgeableCall, 'duration_seconds'>): boolean {
  return (call.duration_seconds ?? 0) > 0
}

/** 卡片上那一行。说人话，而且**不假装知道通话内容** —— 没摘要就说没摘要。 */
export function callSummaryLine(call: BridgeableCall, answered: boolean): string {
  const dir = call.direction === 'inbound' ? '客人打进来' : '打过去'
  if (!answered) return `${dir}，没接通`
  const mins = Math.round((call.duration_seconds ?? 0) / 60)
  const len = mins >= 1 ? `聊了 ${mins} 分钟` : '聊了不到一分钟'
  const said = call.summary?.trim()
  return said ? `${dir}，${len}：${said}` : `${dir}，${len}（还没出摘要）`
}

export type BridgeResult =
  | { ok: true; created: boolean; contactId: string }
  | { ok: false; reason: 'simulated' | 'no_number' | 'no_contact' | 'no_client'; detail?: string }

/**
 * 把一通电话写进 CRM。
 *
 * **永不抛异常** —— 这一步失败绝不能让通话本身的收尾失败。电话已经打完了，
 * 为一条记录把整个 finalize 判失败，只会让重试机制反复重跑一通已经结束的通话。
 *
 * 幂等：`(client_id, source, source_ref)` 唯一，同一通电话重跑不会写第二条。
 */
export async function bridgeCallToCrm(call: BridgeableCall): Promise<BridgeResult> {
  // ① 演练电话不进客户的 CRM。
  if (call.is_simulated) return { ok: false, reason: 'simulated' }

  const raw = counterpartyNumber(call)
  const phone = normalisePhone(raw, 'NZ')
  if (!phone) return { ok: false, reason: 'no_number', detail: raw ?? '(空)' }

  // 这通电话属于哪个客户 —— 语音那边按 tenant 分，CRM 按 client 分。
  const { data: tenantRow } = await supabaseAdmin
    .from('voice_calls')
    .select('tenant_id, voice_tenants!inner(client_id)')
    .eq('id', call.id)
    .maybeSingle()

  const clientId = (tenantRow as { voice_tenants?: { client_id?: string } } | null)
    ?.voice_tenants?.client_id
  if (!clientId) return { ok: false, reason: 'no_client' }

  // ② 客人打进来的才建人；我们打出去的只挂已有的人。
  let contactId: string | null
  let created = false
  const occurredAt = call.started_at ?? call.ended_at ?? new Date().toISOString()

  if (call.direction === 'inbound') {
    const res = await resolveContact({
      clientId,
      identities: [{ kind: 'phone', value: phone }],
      source: 'voice',
      seenAt: occurredAt,
    })
    contactId = res.contactId
    created = res.created
  } else {
    const { data } = await supabaseAdmin
      .from('contact_identities')
      .select('contact_id')
      .eq('client_id', clientId)
      .eq('kind', 'phone')
      .eq('value', phone)
      .maybeSingle()
    contactId = (data?.contact_id as string | undefined) ?? null
  }

  // 挂不上就如实报，不静悄悄地丢 —— 这个数字能看出外呼名单跟 CRM 脱节多严重。
  if (!contactId) return { ok: false, reason: 'no_contact', detail: phone }

  const answered = wasAnswered(call)
  const outcome = callOutcomeToCrm(call.outcome, answered)

  const { error } = await supabaseAdmin.from('contact_touchpoints').upsert(
    {
      client_id: clientId,
      contact_id: contactId,
      channel: 'phone',
      direction: call.direction,
      occurred_at: occurredAt,
      summary: callSummaryLine(call, answered),
      raw: call.summary ?? null,
      metadata: {
        outcome,
        // ③ 客人在电话里说「别再打了」→ 立刻落成合规标记，不等人去点。
        do_not_contact: outcome === 'not_interested' && call.outcome === 'not_interested',
        travel_window: null,
        tour_interest: null,
        competitor: null,
        callback_at: null,
        voice_call_id: call.id,
        voice_outcome: call.outcome,
        // AI 打的电话不是「有人跟过他」—— 跟 Mailchimp 群发、Meta AI 秒回同一条道理。
        // 读路径（今天该联系谁）据此不把它算成今天已联系。
        automated: true,
        logged_by: null,
      },
      source: VOICE_TOUCHPOINT_SOURCE,
      source_ref: call.id,
    },
    { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
  )

  if (error) {
    console.error('[voice/crm-bridge] 写触点失败:', error.message)
    return { ok: false, reason: 'no_contact', detail: error.message }
  }

  return { ok: true, created, contactId }
}
