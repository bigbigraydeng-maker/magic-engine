/**
 * 同事已经一对一给客人发了「点名具体团 / 出发日」的推荐邮件，他却还停在「已联系」——
 * 把他推进到「已报价」。
 *
 * ## 为什么要有这一步
 *
 * 目前没有任何一处会把人从「已联系」往后推：`advance-after-call.ts` 只管「新线索 → 已联系」，
 * `stage-infer.ts` 只填还没有阶段的人。结果是同事明明已经发了推荐行程，名单上他仍显示「已联系」，
 * 今天要联系那一页会把他当成还没报价的人（2026-11-01 PM 抽屉里发现 Andrea Jukes，当天按同一判据人工补改了 29 位）。
 *
 * ## 判据窄到不会错（第一版只用规则，不问模型）
 *
 * 只改同时满足下面全部条件的人：
 *   · 当前阶段是 `contacted`，且没有被标「不要再联系」
 *   · 有一封**人发的**一对一外发邮件（来源是同事邮箱同步，排除群发和自动回执，判据 `isAutomatedTouch`），
 *     主题同时点名「推荐 / 建议」和「出发日 / 具体团」（见 `isQuoteEmailSubject`）；转发（Fw / Fwd）不算
 *   · 如果最近一次改阶段是**人**手动做的、而且比这封邮件还晚——人已经重新定过了，不碰
 *   · 这个客户的阶段配置里确实有 `quoted`
 * 只往前推这一档，永远不往回退；拿不准的（主题没点名团 / 日期）一律不动，仍归同事判断。
 *
 * 落库方式与 `advance-after-call.ts` 一致：UPDATE 的 WHERE 再判一次阶段和阶段时间没变，留痕写不上就把阶段退回去。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { isAutomatedTouch } from './automated-touch'
import { QUOTE_EMAIL_ACTOR, isAutomatedActor } from './actors'
import { isHumanActor } from './human-actor'
import { loadClientsWithSafeStages, loadConfiguredStages } from './stage-infer'

const FROM_STAGE = 'contacted'
const TO_STAGE = 'quoted'
const PAGE_SIZE = 200
/** 一轮最多真的改这么多人，防止某天数据暴涨变成一次大批量改动。 */
const MAX_ADVANCE_PER_RUN = 100
const MAX_SCAN_PER_RUN = 5000
const IN_CHUNK = 100

export interface QuoteAdvanceResult {
  /** 阶段是「已联系」、被拿来检查的人数。 */
  candidates: number
  /** 真的推进到「已报价」的人数。 */
  advanced: number
  /** 写库失败的人数（下一轮会再试）。 */
  failed: number
}

interface CandidateRow {
  id: string
  client_id: string
  stage_updated_at: string | null
}

/** 主题里的「出发日」：`departing on 16 Nov 2026` / `departure 13 May` / `March 2027 departure` / `30 July 2027`。 */
const DEPARTURE_RE =
  /\bdepart(?:ing|ure|s)?\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?:\s+20\d\d)?|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+20\d\d\b/i
/**
 * 主题里的「推荐 / 建议」措辞（同事发推荐行程用的固定开头）。
 * 🔴 故意不含 quote / quotation / itinerary：客人自己发来的主题常带 `Quote Request`，
 * 回信 `Re: ... Quote Request` 会被误当成我们给他报了价（2026-11-01 拿生产数据试跑时抓到 2 例）。
 */
const RECOMMEND_RE = /\b(?:recommendation|recommend|suggestion|suggest)\b/i
/** 转发邮件不算「我们给他报了价」（可能是转给别人）。 */
const FORWARD_RE = /^\s*(?:fw|fwd)\s*:/i

/**
 * 这个主题是不是「同事发给客人的推荐行程」：必须同时有推荐措辞和出发日。
 * 只有一半（如只写 `My recommendation for your travel to China`，或只写 `Tour`）不算——宁可漏判留给同事，也不错判。
 */
export function isQuoteEmailSubject(subject: string | null | undefined): boolean {
  const s = (subject ?? '').trim()
  if (!s || FORWARD_RE.test(s)) return false
  return RECOMMEND_RE.test(s) && DEPARTURE_RE.test(s)
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** 每个人最近一次改阶段是谁、什么时候改的。 */
async function latestStageChange(
  db: SupabaseClient,
  contactIds: string[],
): Promise<Map<string, { changed_by: string | null; created_at: string }>> {
  const latest = new Map<string, { changed_by: string | null; created_at: string }>()
  const { data, error } = await db
    .from('contact_stage_events')
    .select('contact_id, changed_by, created_at')
    .in('contact_id', contactIds)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`读阶段变更失败: ${error.message}`)
  for (const e of (data ?? []) as { contact_id: string; changed_by: string | null; created_at: string }[]) {
    if (!latest.has(e.contact_id)) latest.set(e.contact_id, e)
  }
  return latest
}

/** 发过推荐邮件的人：值是最近一封的主题和发出时间。 */
async function quoteMailsSent(
  db: SupabaseClient,
  contactIds: string[],
): Promise<Map<string, { subject: string; occurred_at: string }>> {
  const { data, error } = await db
    .from('contact_touchpoints')
    .select('contact_id, source, summary, metadata, occurred_at')
    .in('contact_id', contactIds)
    .eq('direction', 'outbound')
    .eq('channel', 'email')
    .order('occurred_at', { ascending: false })
  if (error) throw new Error(`读外发邮件失败: ${error.message}`)
  const out = new Map<string, { subject: string; occurred_at: string }>()
  for (const t of (data ?? []) as {
    contact_id: string
    source: string | null
    summary: string | null
    metadata: Record<string, unknown> | null
    occurred_at: string
  }[]) {
    if (out.has(t.contact_id)) continue
    if (isAutomatedTouch(t.source, t.metadata) || !isQuoteEmailSubject(t.summary)) continue
    out.set(t.contact_id, { subject: (t.summary ?? '').trim(), occurred_at: t.occurred_at })
  }
  return out
}

/** 人在这封邮件之后又手动定过阶段 → 尊重他，不碰。 */
function humanDecidedAfter(
  change: { changed_by: string | null; created_at: string } | undefined,
  mailAt: string,
): boolean {
  if (!change) return false
  if (!isHumanActor(change.changed_by) || isAutomatedActor(change.changed_by)) return false
  return new Date(change.created_at).getTime() > new Date(mailAt).getTime()
}

async function applyQuoted(db: SupabaseClient, row: CandidateRow, subject: string, now: Date): Promise<boolean> {
  const nowIso = now.toISOString()
  let q = db
    .from('contacts')
    .update({ stage: TO_STAGE, stage_updated_at: nowIso, updated_at: nowIso })
    .eq('id', row.id)
    .eq('client_id', row.client_id)
    .eq('stage', FROM_STAGE)
  q = row.stage_updated_at === null ? q.is('stage_updated_at', null) : q.eq('stage_updated_at', row.stage_updated_at)
  const { data, error } = await q.select('id')
  if (error) throw new Error(`改阶段失败: ${error.message}`)
  if (!data || data.length === 0) return false // 被员工抢先改了，不算失败

  const { error: aErr } = await db.from('contact_stage_events').insert({
    client_id: row.client_id,
    contact_id: row.id,
    from_stage: FROM_STAGE,
    to_stage: TO_STAGE,
    changed_by: QUOTE_EMAIL_ACTOR,
    note: `同事已一对一发出推荐邮件「${subject.slice(0, 120)}」，已联系自动改为已报价`,
  })
  if (aErr) {
    // 留痕写不上就不留一个没有来历的阶段：条件卡死在我们刚写的值上，中间被改过就不会误伤。
    await db
      .from('contacts')
      .update({ stage: FROM_STAGE, stage_updated_at: row.stage_updated_at })
      .eq('id', row.id)
      .eq('client_id', row.client_id)
      .eq('stage', TO_STAGE)
      .eq('stage_updated_at', nowIso)
    throw new Error(`留痕失败，已把阶段退回: ${aErr.message}`)
  }
  return true
}

export async function advanceContactedAfterQuoteEmail(
  now: Date,
  db: SupabaseClient = supabaseAdmin,
): Promise<QuoteAdvanceResult> {
  const result: QuoteAdvanceResult = { candidates: 0, advanced: 0, failed: 0 }
  const clientIds = await loadClientsWithSafeStages()

  for (const clientId of clientIds) {
    const configured = await loadConfiguredStages(clientId)
    if (!configured.has(TO_STAGE) || !configured.has(FROM_STAGE)) continue

    // 用 id 往后翻（不是偏移量）：翻的过程中被改掉的人会离开「已联系」，偏移量会漏人。
    let lastId: string | null = null
    for (;;) {
      if (result.candidates >= MAX_SCAN_PER_RUN || result.advanced >= MAX_ADVANCE_PER_RUN) break
      let q = db
        .from('contacts')
        .select('id, client_id, stage_updated_at')
        .eq('client_id', clientId)
        .eq('stage', FROM_STAGE)
        .eq('do_not_contact', false)
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)
      if (lastId !== null) q = q.gt('id', lastId)
      const { data, error } = await q
      if (error) throw new Error(`捞已联系的人失败: ${error.message}`)
      const rows = (data ?? []) as CandidateRow[]
      if (rows.length === 0) break
      result.candidates += rows.length
      lastId = rows[rows.length - 1].id

      for (const part of chunk(rows, IN_CHUNK)) {
        const ids = part.map((r) => r.id)
        const [mails, changes] = await Promise.all([quoteMailsSent(db, ids), latestStageChange(db, ids)])
        for (const row of part) {
          if (result.advanced >= MAX_ADVANCE_PER_RUN) break
          const mail = mails.get(row.id)
          if (!mail || humanDecidedAfter(changes.get(row.id), mail.occurred_at)) continue
          try {
            if (await applyQuoted(db, row, mail.subject, now)) result.advanced++
          } catch (err) {
            result.failed++
            console.warn(`[crm/advance-after-quote] ${row.id} 失败：`, err instanceof Error ? err.message : err)
          }
        }
      }
      if (rows.length < PAGE_SIZE) break
    }
  }
  return result
}
