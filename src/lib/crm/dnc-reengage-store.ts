/**
 * 「客人自己回来找我们」的 Supabase IO —— 把 `dnc-reengage.ts` 的纯判据接到库上。
 *
 * ## 先写触点，再放下那一列
 *
 * 判据看的是**触点**（见 `lib/crm/dnc`）。反过来的话，中间失败会留下
 * 「列已经放下、但触点还说别再联系」—— 页面上看着像取消了，实际这个人照旧
 * 被排除，而没有任何记录说明发生过什么。所以触点先落，`contacts.do_not_contact`
 * 后放。那一列没放下时，下一轮判据已经说「不是拒联」、这个人不会再走解除路径 ——
 * 所以定时任务对「列还是 true、判据说不是拒联」的人单独补放一次（`releaseMirror`）。
 *
 * ## 写之前再读一遍
 *
 * 扫描拿到的是几分钟前的快照；写之前对这一个人重新读、重新判，判决变了（中间有人
 * 又记了一笔别再联系）就不写。解除触点的时间用**触发那一刻**，不用「现在」：之后
 * 补记进来的拒联只要晚于客人的动作，就仍然是最后一次判决。
 *
 * ## 私信为什么从 `conversation_messages` 读
 *
 * `contact_touchpoints` 里 messenger / whatsapp 的触点是一条**会话聚合**：
 * 它的 `occurred_at` 会随着新消息往后挪。拿它当「客人又发了一句」的证据，
 * 时间点对不上，也分不清是客人说的还是我们说的。所以私信一律从
 * `conversation_messages` 里按 `direction = 'inbound'` 取，时间用 `sent_at`。
 *
 * ## 幂等
 *
 * 自动解除写成一条 `source = 'me_system'`、`source_ref = dnc-reengage:<contact>:<trigger>`
 * 的触点。同一个触发点重跑只会命中唯一键，`ignoreDuplicates` 让它安静地跳过 ——
 * 返回 `null` 就表示「之前已经写过」。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { DNC_CLEARED_OUTCOME } from '@/lib/crm/dnc'
import { isAutomatedTouch } from '@/lib/crm/automated-touch'
import {
  decideReengageClear,
  type ReengageDecision,
  type ReengageInput,
  type ReengageMessage,
  type ReengageTouch,
} from '@/lib/crm/dnc-reengage'

const BATCH = 100
const PAGE = 1000

export const REENGAGE_CLEARED_BY = 'system:customer-reengaged'
export const REENGAGE_SOURCE = 'me_system'

interface ContactRow {
  id: string
  do_not_contact: boolean | null
  do_not_contact_reason: string | null
}

export interface TouchRow {
  id: string
  contact_id: string | null
  channel: string
  direction: string
  occurred_at: string
  summary: string | null
  raw: string | null
  metadata: Record<string, unknown> | null
  source: string | null
}

interface ConversationRow {
  id: string
  contact_id: string | null
  channel: string
}

interface MessageRow {
  id: string
  conversation_id: string
  direction: string
  body: string | null
  sent_at: string
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

async function listFlaggedContactIds(clientId: string): Promise<string[]> {
  const ids = new Set<string>()

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('client_id', clientId)
      .eq('do_not_contact', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`[dnc-reengage] 读拒联联系人失败: ${error.message}`)
    const rows = (data ?? []) as { id: string }[]
    for (const r of rows) ids.add(r.id)
    if (rows.length < PAGE) break
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('contact_touchpoints')
      .select('contact_id')
      .eq('client_id', clientId)
      .or('metadata->>outcome.eq.do_not_contact,metadata->>do_not_contact.eq.true')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`[dnc-reengage] 读拒联触点失败: ${error.message}`)
    const rows = (data ?? []) as { contact_id: string | null }[]
    for (const r of rows) if (r.contact_id) ids.add(r.contact_id)
    if (rows.length < PAGE) break
  }

  return [...ids]
}

async function loadContacts(clientId: string, ids: string[]): Promise<ContactRow[]> {
  const out: ContactRow[] = []
  for (const batch of chunk(ids, BATCH)) {
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('id, do_not_contact, do_not_contact_reason')
      .eq('client_id', clientId)
      .in('id', batch)
    if (error) throw new Error(`[dnc-reengage] 读联系人失败: ${error.message}`)
    out.push(...((data ?? []) as ContactRow[]))
  }
  return out
}

async function loadTouches(clientId: string, ids: string[]): Promise<TouchRow[]> {
  const out: TouchRow[] = []
  for (const batch of chunk(ids, BATCH)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('contact_touchpoints')
        .select('id, contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
        .eq('client_id', clientId)
        .in('contact_id', batch)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw new Error(`[dnc-reengage] 读触点失败: ${error.message}`)
      const rows = (data ?? []) as TouchRow[]
      out.push(...rows)
      if (rows.length < PAGE) break
    }
  }
  return out
}

async function loadInboundMessages(
  clientId: string,
  ids: string[],
): Promise<{ contactId: string; message: ReengageMessage }[]> {
  const out: { contactId: string; message: ReengageMessage }[] = []

  for (const batch of chunk(ids, BATCH)) {
    const { data: convData, error: convErr } = await supabaseAdmin
      .from('conversations')
      .select('id, contact_id, channel')
      .eq('client_id', clientId)
      .in('contact_id', batch)
    if (convErr) throw new Error(`[dnc-reengage] 读会话失败: ${convErr.message}`)

    const convs = ((convData ?? []) as ConversationRow[]).filter(
      (c): c is ConversationRow & { contact_id: string; channel: 'messenger' | 'whatsapp' } =>
        c.contact_id !== null && (c.channel === 'messenger' || c.channel === 'whatsapp'),
    )
    if (convs.length === 0) continue

    const byConv = new Map<string, { contactId: string; channel: 'messenger' | 'whatsapp' }>()
    for (const c of convs) byConv.set(c.id, { contactId: c.contact_id, channel: c.channel })

    for (const convBatch of chunk([...byConv.keys()], BATCH)) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from('conversation_messages')
          .select('id, conversation_id, direction, body, sent_at')
          .in('conversation_id', convBatch)
          .eq('direction', 'inbound')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) throw new Error(`[dnc-reengage] 读私信失败: ${error.message}`)
        const rows = (data ?? []) as MessageRow[]
        for (const m of rows) {
          const conv = byConv.get(m.conversation_id)
          if (!conv) continue
          out.push({
            contactId: conv.contactId,
            message: { id: m.id, channel: conv.channel, sentAt: m.sent_at, body: m.body },
          })
        }
        if (rows.length < PAGE) break
      }
    }
  }

  return out
}

export function toReengageTouch(r: TouchRow): ReengageTouch {
  const meta = r.metadata ?? {}
  const outcome = typeof meta.outcome === 'string' ? meta.outcome : null
  const subject = typeof meta.subject === 'string' ? meta.subject : r.summary
  return {
    id: r.id,
    source: r.source,
    channel: r.channel,
    direction: r.direction === 'outbound' ? 'outbound' : 'inbound',
    occurredAt: r.occurred_at,
    outcome,
    flagged: meta.do_not_contact === true,
    subject,
    body: r.raw,
    automated: isAutomatedTouch(r.source, meta),
    talkSeconds: typeof meta.talk_seconds === 'number' ? meta.talk_seconds : null,
  }
}

export interface ReengageCandidate {
  contactId: string
  input: ReengageInput
}

export async function loadReengageCandidates(clientId: string): Promise<ReengageCandidate[]> {
  const ids = await listFlaggedContactIds(clientId)
  if (ids.length === 0) return []
  return loadCandidatesFor(clientId, ids)
}

async function loadCandidatesFor(clientId: string, ids: string[]): Promise<ReengageCandidate[]> {
  const contacts = await loadContacts(clientId, ids)
  const touches = await loadTouches(clientId, ids)
  const messages = await loadInboundMessages(clientId, ids)

  const touchesByContact = new Map<string, ReengageTouch[]>()
  for (const t of touches) {
    if (!t.contact_id) continue
    const list = touchesByContact.get(t.contact_id) ?? []
    list.push(toReengageTouch(t))
    touchesByContact.set(t.contact_id, list)
  }

  const messagesByContact = new Map<string, ReengageMessage[]>()
  for (const m of messages) {
    const list = messagesByContact.get(m.contactId) ?? []
    list.push(m.message)
    messagesByContact.set(m.contactId, list)
  }

  return contacts.map((c) => ({
    contactId: c.id,
    input: {
      contactFlag: c.do_not_contact === true,
      reason: c.do_not_contact_reason,
      touches: touchesByContact.get(c.id) ?? [],
      inboundMessages: messagesByContact.get(c.id) ?? [],
    },
  }))
}

export interface ApplyResult {
  /** false = a fresh re-read no longer agrees (a newer verdict arrived) — nothing was written. */
  written: boolean
  /** null when written but the row already existed (idempotent retry), or when not written. */
  touchpointId: string | null
}

/**
 * Re-read this one contact right before writing and only write if the decision still stands on the same trigger.
 * The sweep's snapshot can be minutes old; a do-not-contact logged in between must win (魏征 2026-11-08).
 */
export async function applyReengageClear(
  clientId: string,
  contactId: string,
  decision: Extract<ReengageDecision, { clear: true }>,
): Promise<ApplyResult> {
  const fresh = (await loadCandidatesFor(clientId, [contactId]))[0]
  const again = fresh ? decideReengageClear(fresh.input) : null
  if (!again || !again.clear || again.trigger.ref !== decision.trigger.ref) return { written: false, touchpointId: null }

  const touchpointId = await insertClearTouch(clientId, contactId, decision)
  await releaseMirror(clientId, contactId)
  return { written: true, touchpointId }
}

async function insertClearTouch(
  clientId: string,
  contactId: string,
  decision: Extract<ReengageDecision, { clear: true }>,
): Promise<string | null> {
  const t = decision.trigger
  const summary = '系统：客人主动再联系，自动解除「别再联系」'
  const { data, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        // Fixed channel, never the trigger's: lead counters count rows by channel (meta_lead_form) without
        // looking at direction/source, so copying it would invent a lead. Same channel as the human clear path.
        channel: 'phone',
        direction: 'outbound',
        // The trigger's own time, not "now": any do-not-contact recorded later than the customer's action —
        // even one that syncs in late with an earlier timestamp than now — must still be the latest verdict.
        occurred_at: t.at,
        summary,
        raw: `${summary}（触发：${t.kind} @ ${t.at}；拒联判决时间：${decision.dncAt}）`,
        metadata: {
          outcome: DNC_CLEARED_OUTCOME,
          do_not_contact: false,
          automated: true,
          cleared_by: REENGAGE_CLEARED_BY,
          trigger_kind: t.kind,
          trigger_ref: t.ref,
          trigger_channel: t.channel,
          trigger_at: t.at,
          dnc_at: decision.dncAt,
          dnc_at_source: decision.dncAtSource,
        },
        source: REENGAGE_SOURCE,
        source_ref: `dnc-reengage:${contactId}:${t.ref}`,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`[dnc-reengage] 写解除触点失败: ${error.message}`)
  return (data as { id: string } | null)?.id ?? null
}

/**
 * Put `contacts.do_not_contact` down. Also used to repair a mirror left at true after the judge already says
 * "not do-not-contact" (the touchpoint was written but this update failed last time) — otherwise that contact is
 * never revisited and bulk sends / today's list keep blocking them off the stale column.
 */
export async function releaseMirror(clientId: string, contactId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('contacts')
    .update({ do_not_contact: false })
    .eq('id', contactId)
    .eq('client_id', clientId)
  if (error) throw new Error(`[dnc-reengage] contacts.do_not_contact 没更新上: ${error.message}`)
}
