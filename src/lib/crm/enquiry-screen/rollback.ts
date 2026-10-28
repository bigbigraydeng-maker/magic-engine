/**
 * 一键回退：把「机器筛选判成非咨询」的人还原到判之前的阶段。
 *
 * 设计稿：docs/specs/2026-10-29-crm-enquiry-screen-runner-v0.md §7 P2（魏征 BLOCKER：回退脚本原先不存在）。
 *
 * 只还原同时满足下面全部条件的人（事后被人改过的一概不动）：
 *   · 当前阶段仍是「非咨询」
 *   · 最近一条阶段变更是 `ai:enquiry-screen` 写的「→ 非咨询」
 * 还原到那条事件记下的 `from_stage`（原来是空的就还原成空），UPDATE 带条件
 * （`.eq('stage','not_enquiry')` + 阶段时间没变），并补一条 `ai:enquiry-screen-rollback` 事件。
 * 被回退过的人**永久**不再参加筛选（见 `eligibility.ts` 的 `rolled_back`）。
 *
 * 默认只演练（apply=false）：只告诉你「将还原 M 人」，一个字都不写。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ENQUIRY_SCREEN_ACTOR, ENQUIRY_SCREEN_ROLLBACK_ACTOR } from '../actors'
import { NOT_ENQUIRY_STAGE_KEY } from './types'

export interface RollbackPlanItem {
  contactId: string
  restoreTo: string | null
  stageUpdatedAt: string | null
}

export interface RollbackResult {
  /** 符合条件、将被还原的人数。 */
  planned: number
  /** 真的还原了的人数（演练恒为 0）。 */
  restored: number
  /** 写库时发现已被别人改过、跳过的人数。 */
  skipped: number
  items: RollbackPlanItem[]
}

const PAGE_SIZE = 500

interface ContactRow {
  id: string
  stage_updated_at: string | null
}
interface EventRow {
  contact_id: string
  from_stage: string | null
  to_stage: string | null
  changed_by: string | null
  created_at: string
}

export async function rollbackScreenedContacts(
  db: SupabaseClient,
  clientId: string,
  opts: { apply: boolean },
): Promise<RollbackResult> {
  const result: RollbackResult = { planned: 0, restored: 0, skipped: 0, items: [] }

  let lastId: string | null = null
  for (;;) {
    let q = db
      .from('contacts')
      .select('id, stage_updated_at')
      .eq('client_id', clientId)
      .eq('stage', NOT_ENQUIRY_STAGE_KEY)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)
    if (lastId !== null) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw new Error(`捞非咨询的人失败: ${error.message}`)
    const rows = (data ?? []) as ContactRow[]
    if (rows.length === 0) break
    lastId = rows[rows.length - 1].id

    const { data: evData, error: evErr } = await db
      .from('contact_stage_events')
      .select('contact_id, from_stage, to_stage, changed_by, created_at')
      .in('contact_id', rows.map((r) => r.id))
      .order('created_at', { ascending: false })
    if (evErr) throw new Error(`读阶段变更失败: ${evErr.message}`)
    const latest = new Map<string, EventRow>()
    for (const e of (evData ?? []) as EventRow[]) if (!latest.has(e.contact_id)) latest.set(e.contact_id, e)

    for (const row of rows) {
      const e = latest.get(row.id)
      if (!e || e.changed_by !== ENQUIRY_SCREEN_ACTOR || e.to_stage !== NOT_ENQUIRY_STAGE_KEY) continue
      result.planned++
      result.items.push({ contactId: row.id, restoreTo: e.from_stage, stageUpdatedAt: row.stage_updated_at })
      if (!opts.apply) continue

      const nowIso = new Date().toISOString()
      let upd = db
        .from('contacts')
        .update({ stage: e.from_stage, stage_updated_at: nowIso, updated_at: nowIso })
        .eq('id', row.id)
        .eq('client_id', clientId)
        .eq('stage', NOT_ENQUIRY_STAGE_KEY)
      upd = row.stage_updated_at === null ? upd.is('stage_updated_at', null) : upd.eq('stage_updated_at', row.stage_updated_at)
      const { data: done, error: uErr } = await upd.select('id')
      if (uErr) throw new Error(`还原失败: ${uErr.message}`)
      if (!done || done.length === 0) {
        result.skipped++
        continue
      }
      const { error: aErr } = await db.from('contact_stage_events').insert({
        client_id: clientId,
        contact_id: row.id,
        from_stage: NOT_ENQUIRY_STAGE_KEY,
        to_stage: e.from_stage,
        changed_by: ENQUIRY_SCREEN_ROLLBACK_ACTOR,
        note: '回退：撤销机器判的「非咨询」',
      })
      if (aErr) {
        await db
          .from('contacts')
          .update({ stage: NOT_ENQUIRY_STAGE_KEY, stage_updated_at: row.stage_updated_at })
          .eq('id', row.id)
          .eq('client_id', clientId)
          .eq('stage', e.from_stage)
          .eq('stage_updated_at', nowIso)
        throw new Error(`留痕失败，已把阶段退回: ${aErr.message}`)
      }
      result.restored++
    }
    if (rows.length < PAGE_SIZE) break
  }
  return result
}
