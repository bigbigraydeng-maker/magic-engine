/**
 * 被机器判成「非咨询」的人，又来了一条真消息 —— 把他放回「新线索」。
 *
 * 设计稿：docs/specs/2026-10-29-crm-enquiry-screen-runner-v0.md §7 P1（魏征 BLOCKER）、
 * 2026-10-21 valid-leads 设计稿 §5.3.1。
 *
 * ## 为什么要有这一步
 *
 * 「非咨询」的营销动作是「停止营销」，名单（segments.ts）对这类阶段在「客户回了话」之前就排除。
 * 所以机器一旦把一个人判错，他再来信问价也会永远躺在「先放着」里 —— 而且没有任何报错。
 *
 * ## 为什么写在阶段上、不在读侧改判
 *
 * 读阶段的地方有好几处（名单、今天名单、跟进提醒…），各改一份判据迟早漂移。
 * 这里直接把阶段改回「新线索」，所有读阶段的地方自然一致。代价是最多晚一小时（每小时扫一轮）。
 *
 * ## 判据窄到不会错（安全方向：多放进来，不少放）
 *
 * 只动同时满足下面全部条件的人：
 *   · 当前阶段是「非咨询」
 *   · 最近一条阶段变更的操作者是机器筛选（`ai:enquiry-screen`）——**人标的非咨询（含人工「退回」）一律不碰**
 *   · 这次判走**之后**入库的入站消息里，有一条是真消息：不是机器发的、不是自动回复、
 *     不是邮件打开/点击；来电只算已接通的
 *   · 没标「别再联系」
 * 比较用入站触点的入库时间 `created_at`，不是邮件发出时间（晚同步进来的旧邮件不算新消息）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { isAutoReply } from '@/lib/microsoft/auto-reply'
import { isAutomatedTouch } from '../automated-touch'
import { ENQUIRY_REVIVE_ACTOR, ENQUIRY_SCREEN_ACTOR } from '../actors'
import { engagementFromMetadata } from '../segments'
import { NOT_ENQUIRY_STAGE_KEY } from './types'

const TO_STAGE = 'new'
const PAGE_SIZE = 200
const MAX_REVIVE_PER_RUN = 100
const MAX_SCAN_PER_RUN = 5000
const IN_CHUNK = 100

export interface ReviveResult {
  /** 阶段是「非咨询」、被拿来检查的人数。 */
  candidates: number
  /** 真的放回「新线索」的人数。 */
  revived: number
  /** 写库失败的人数（下一轮会再试）。 */
  failed: number
}

interface CandidateRow {
  id: string
  client_id: string
  stage_updated_at: string | null
}

interface InboundTouch {
  contact_id: string
  channel: string
  source: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** 这条入站消息算不算「真消息」。纯函数，单独测。 */
export function isRealInbound(t: Pick<InboundTouch, 'channel' | 'source' | 'metadata'>): boolean {
  const md = t.metadata
  if (isAutomatedTouch(t.source, md)) return false
  if (engagementFromMetadata(md)) return false
  const subject = typeof md?.subject === 'string' ? (md.subject as string) : null
  if (isAutoReply(subject)) return false
  // 来电只算接通的；未接来电不是「他说了话」。
  if (t.channel === 'phone') return md?.reached === true
  return true
}

/** 这批人里：最近一条阶段变更是机器筛选判的「非咨询」→ 返回判走的时间。 */
async function machineScreenedAt(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('contact_stage_events')
    .select('contact_id, changed_by, to_stage, created_at')
    .in('contact_id', ids)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`读阶段变更失败: ${error.message}`)
  const seen = new Set<string>()
  const out = new Map<string, string>()
  for (const e of (data ?? []) as { contact_id: string; changed_by: string | null; to_stage: string | null; created_at: string }[]) {
    if (seen.has(e.contact_id)) continue
    seen.add(e.contact_id)
    if (e.changed_by === ENQUIRY_SCREEN_ACTOR && e.to_stage === NOT_ENQUIRY_STAGE_KEY) out.set(e.contact_id, e.created_at)
  }
  return out
}

/** 判走之后有没有真消息入库：返回有的人 → 一句话原因。 */
async function newRealInbound(db: SupabaseClient, screened: Map<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (screened.size === 0) return out
  const { data, error } = await db
    .from('contact_touchpoints')
    .select('contact_id, channel, source, metadata, created_at')
    .in('contact_id', Array.from(screened.keys()))
    .eq('direction', 'inbound')
  if (error) throw new Error(`读入站触点失败: ${error.message}`)
  for (const t of (data ?? []) as InboundTouch[]) {
    const at = screened.get(t.contact_id)
    if (!at || out.has(t.contact_id)) continue
    if (Date.parse(t.created_at) <= Date.parse(at)) continue
    if (!isRealInbound(t)) continue
    out.set(t.contact_id, '之前被机器判成非咨询，又来了新消息')
  }
  return out
}

async function applyRevive(db: SupabaseClient, row: CandidateRow, why: string, now: Date): Promise<boolean> {
  const nowIso = now.toISOString()
  let q = db
    .from('contacts')
    .update({ stage: TO_STAGE, stage_updated_at: nowIso, updated_at: nowIso })
    .eq('id', row.id)
    .eq('client_id', row.client_id)
    .eq('stage', NOT_ENQUIRY_STAGE_KEY)
  q = row.stage_updated_at === null ? q.is('stage_updated_at', null) : q.eq('stage_updated_at', row.stage_updated_at)
  const { data, error } = await q.select('id')
  if (error) throw new Error(`改阶段失败: ${error.message}`)
  if (!data || data.length === 0) return false // 被员工抢先改了，不算失败

  const { error: aErr } = await db.from('contact_stage_events').insert({
    client_id: row.client_id,
    contact_id: row.id,
    from_stage: NOT_ENQUIRY_STAGE_KEY,
    to_stage: TO_STAGE,
    changed_by: ENQUIRY_REVIVE_ACTOR,
    note: why,
  })
  if (aErr) {
    await db
      .from('contacts')
      .update({ stage: NOT_ENQUIRY_STAGE_KEY, stage_updated_at: row.stage_updated_at })
      .eq('id', row.id)
      .eq('client_id', row.client_id)
      .eq('stage', TO_STAGE)
      .eq('stage_updated_at', nowIso)
    throw new Error(`留痕失败，已把阶段退回: ${aErr.message}`)
  }
  return true
}

/**
 * 阶段配置里同时有「非咨询」和「新线索」的客户。
 *
 * 不借用 `stage-infer` 的 `loadClientsWithSafeStages`：那个要求整条旅游漏斗配齐，
 * 非旅游客户永远通不过，放回名单对他们就悄悄不生效了。这里只要这两档在就行。
 */
async function clientsWithScreenStages(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db
    .from('client_pipeline_stages')
    .select('client_id, stage_key')
    .in('stage_key', [NOT_ENQUIRY_STAGE_KEY, TO_STAGE])
  if (error) throw new Error(`读阶段配置失败: ${error.message}`)
  const byClient = new Map<string, Set<string>>()
  for (const row of (data ?? []) as { client_id: string; stage_key: string }[]) {
    const set = byClient.get(row.client_id) ?? new Set<string>()
    set.add(row.stage_key)
    byClient.set(row.client_id, set)
  }
  return Array.from(byClient.entries())
    .filter(([, set]) => set.has(NOT_ENQUIRY_STAGE_KEY) && set.has(TO_STAGE))
    .map(([clientId]) => clientId)
}

export async function reviveScreenedOnNewInbound(
  now: Date,
  db: SupabaseClient = supabaseAdmin,
): Promise<ReviveResult> {
  const result: ReviveResult = { candidates: 0, revived: 0, failed: 0 }
  const clientIds = await clientsWithScreenStages(db)
  for (const clientId of clientIds) {
    // 按 id 往后翻页（不是偏移量）：翻的过程中被放回的人会离开「非咨询」，偏移量会漏掉下一页。
    let lastId: string | null = null
    for (;;) {
      if (result.candidates >= MAX_SCAN_PER_RUN || result.revived >= MAX_REVIVE_PER_RUN) break
      let q = db
        .from('contacts')
        .select('id, client_id, stage_updated_at')
        .eq('client_id', clientId)
        .eq('stage', NOT_ENQUIRY_STAGE_KEY)
        .eq('do_not_contact', false)
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)
      if (lastId !== null) q = q.gt('id', lastId)
      const { data, error } = await q
      if (error) throw new Error(`捞非咨询的人失败: ${error.message}`)
      const rows = (data ?? []) as CandidateRow[]
      if (rows.length === 0) break
      result.candidates += rows.length
      lastId = rows[rows.length - 1].id

      for (const part of chunk(rows, IN_CHUNK)) {
        const screened = await machineScreenedAt(db, part.map((r) => r.id))
        const fresh = await newRealInbound(db, screened)
        for (const row of part) {
          if (result.revived >= MAX_REVIVE_PER_RUN) break
          const why = fresh.get(row.id)
          if (!why) continue
          try {
            if (await applyRevive(db, row, why, now)) result.revived++
          } catch (err) {
            result.failed++
            console.warn(`[crm/enquiry-revive] ${row.id} 失败：`, err instanceof Error ? err.message : err)
          }
        }
      }
      if (rows.length < PAGE_SIZE) break
    }
  }
  return result
}
