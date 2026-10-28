/**
 * 我们拨出并接通了电话，客人却还停在「新线索」—— 把他推进到「已联系」。
 *
 * ## 为什么要有这一步
 *
 * 「读往来记录填阶段」（`stage-infer.ts`）只会给**还没有阶段**的人填，而且读不出来就放进
 * 「新线索」。客人填表当天会被放进「新线索」；之后员工打通了电话，那条电话触点的正文是空的
 * （电话的文字稿存在另一张表），既没有任何一处会再去读他，也没有任何一处会因为一通电话改阶段。
 * 结果是：已经打通电话的人一直挂着「新线索」（2026-10-28 PM 在抽屉里发现）。
 *
 * ## 判据窄到不会错
 *
 * 只改同时满足下面全部条件的人：
 *   · 当前阶段是 `new`（新线索）
 *   · 这个阶段是 AI 读往来记录放进去的（最近一条阶段变更的操作者是 `ai:conversation-read`）——
 *     人手动标过的一律不碰
 *   · 有一通外呼电话被判定为「接通」（触点 `metadata.reached === true`，判据在 `call-plan.ts`）
 *   · 这个客户的阶段配置里确实有 `contacted`
 * 只说「已联系」这一档（最不下结论的一档，不终结、不停止跟进），更细的判断仍归员工和读对话那一套。
 *
 * 落库方式与 `stage-infer.ts` 的 `applyStage` 一致：UPDATE 的 WHERE 再判一次阶段和阶段时间没变
 * （取数和写库之间员工可能已经改了），留痕写不上就把阶段退回去。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { CALL_REACHED_ACTOR, STAGE_INFER_ACTOR } from './actors'
import { loadClientsWithSafeStages, loadConfiguredStages } from './stage-infer'

const FROM_STAGE = 'new'
const TO_STAGE = 'contacted'
/** 一轮最多处理这么多人，防止某天数据暴涨变成一次大批量改动。 */
const MAX_PER_RUN = 200
const IN_CHUNK = 100

export interface CallAdvanceResult {
  /** 阶段是「新线索」、被拿来检查的人数。 */
  candidates: number
  /** 真的推进到「已联系」的人数。 */
  advanced: number
  /** 写库失败的人数（下一轮会再试）。 */
  failed: number
}

interface CandidateRow {
  id: string
  client_id: string
  stage_updated_at: string | null
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** 这个人最近一条阶段变更是不是 AI 放进「新线索」的。 */
async function aiPlacedInPool(db: SupabaseClient, contactIds: string[]): Promise<Set<string>> {
  const latest = new Map<string, { changed_by: string | null; to_stage: string | null }>()
  const { data, error } = await db
    .from('contact_stage_events')
    .select('contact_id, changed_by, to_stage, created_at')
    .in('contact_id', contactIds)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`读阶段变更失败: ${error.message}`)
  for (const e of (data ?? []) as { contact_id: string; changed_by: string | null; to_stage: string | null }[]) {
    if (!latest.has(e.contact_id)) latest.set(e.contact_id, e)
  }
  const out = new Set<string>()
  latest.forEach((e, id) => {
    if (e.changed_by === STAGE_INFER_ACTOR && e.to_stage === FROM_STAGE) out.add(id)
  })
  return out
}

/** 有过接通的外呼电话的人（带上最近一通的通话秒数，写进留痕）。 */
async function reachedByCall(db: SupabaseClient, contactIds: string[]): Promise<Map<string, number | null>> {
  const { data, error } = await db
    .from('contact_touchpoints')
    .select('contact_id, metadata')
    .in('contact_id', contactIds)
    .eq('channel', 'phone')
    .eq('direction', 'outbound')
    .order('occurred_at', { ascending: false })
  if (error) throw new Error(`读电话触点失败: ${error.message}`)
  const out = new Map<string, number | null>()
  for (const t of (data ?? []) as { contact_id: string; metadata: Record<string, unknown> | null }[]) {
    if (t.metadata?.reached !== true || out.has(t.contact_id)) continue
    const secs = t.metadata.talk_seconds
    out.set(t.contact_id, typeof secs === 'number' ? secs : null)
  }
  return out
}

async function applyReached(
  db: SupabaseClient,
  row: CandidateRow,
  talkSeconds: number | null,
  now: Date,
): Promise<boolean> {
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

  const secs = talkSeconds === null ? '' : `（${talkSeconds} 秒）`
  const { error: aErr } = await db.from('contact_stage_events').insert({
    client_id: row.client_id,
    contact_id: row.id,
    from_stage: FROM_STAGE,
    to_stage: TO_STAGE,
    changed_by: CALL_REACHED_ACTOR,
    note: `我们拨出的电话已接通${secs}，新线索自动改为已联系`,
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

export async function advanceNewLeadsAfterReachedCall(
  now: Date,
  db: SupabaseClient = supabaseAdmin,
): Promise<CallAdvanceResult> {
  const result: CallAdvanceResult = { candidates: 0, advanced: 0, failed: 0 }
  const clientIds = await loadClientsWithSafeStages()
  if (clientIds.length === 0) return result

  for (const clientId of clientIds) {
    if (result.candidates >= MAX_PER_RUN) break
    const configured = await loadConfiguredStages(clientId)
    if (!configured.has(TO_STAGE) || !configured.has(FROM_STAGE)) continue

    const { data, error } = await db
      .from('contacts')
      .select('id, client_id, stage_updated_at')
      .eq('client_id', clientId)
      .eq('stage', FROM_STAGE)
      .eq('do_not_contact', false)
      .limit(MAX_PER_RUN)
    if (error) throw new Error(`捞新线索失败: ${error.message}`)
    const rows = (data ?? []) as CandidateRow[]
    result.candidates += rows.length

    for (const part of chunk(rows, IN_CHUNK)) {
      const ids = part.map((r) => r.id)
      const [ai, reached] = await Promise.all([aiPlacedInPool(db, ids), reachedByCall(db, ids)])
      for (const row of part) {
        if (!ai.has(row.id) || !reached.has(row.id)) continue
        try {
          if (await applyReached(db, row, reached.get(row.id) ?? null, now)) result.advanced++
        } catch (err) {
          result.failed++
          console.warn(`[crm/advance-after-call] ${row.id} 失败：`, err instanceof Error ? err.message : err)
        }
      }
    }
  }
  return result
}
