/**
 * 上线签字 —— 证据回读。执行方交来的“回执”不信，服务端自己去生产库核对。
 *
 * 核对的是“对的那一行”，不只是“有这么一行”：
 *  · 必须是清单指定的目标客户（evidencePolicy.targetClientId）；
 *  · 必须发生在本轮开始之后（evidencePolicy.roundStartedAt），几个月前的旧记录不算；
 *  · T4 要求 verification.passed === true（不是“非空”）。
 * 只有 pass 才回读；fail 的回执不需要证据存在（失败本身就是结论）。
 *
 * machineVerifiable=false 的项（T2/T6/T7，拒绝原因/判断文字需要人读）：
 *  必须给出 recordRef {table, id} —— 服务端回读这条记录存在、属于目标客户、发生在本轮之后；
 *  语义（“原因含冷却期”之类）仍靠人读，所以页面把它标成“人工确认”并原文展示 description。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Checklist, ChecklistItem } from './types'

export type EvidenceCheck =
  | { readonly ok: true; readonly manual: boolean; readonly snapshot: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** 人工确认项的 recordRef 只许指向这几张表（防止指向任意表探测）。 */
const MANUAL_TABLES = new Set([
  'ad_health_narratives',
  'action_runs',
  'action_run_steps',
  'authorization_decisions',
  'flywheel_actions',
])

function str(ref: Record<string, unknown>, key: string): string | null {
  const v = ref[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

function fail(reason: string): EvidenceCheck {
  return { ok: false, reason }
}

function after(value: unknown, startedAt: string): boolean {
  if (typeof value !== 'string') return false
  const t = Date.parse(value)
  return Number.isFinite(t) && t >= Date.parse(startedAt)
}

type Verifier = (db: SupabaseClient, ref: Record<string, unknown>, policy: Checklist['evidencePolicy']) => Promise<EvidenceCheck>

const t1: Verifier = async (db, ref, policy) => {
  const date = str(ref, 'insightDate')
  if (!date || !DATE.test(date)) return fail('T1 需要 insightDate（YYYY-MM-DD）')
  const { data, error } = await db
    .from('ad_health_narratives')
    .select('id, client_id, insight_date, overall_verdict, created_at')
    .eq('client_id', policy.targetClientId)
    .eq('insight_date', date)
    .limit(1)
  if (error) return fail('读 ad_health_narratives 失败，无法核对')
  const row = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!row) return fail('生产库里没有目标客户该日的 ad_health_narratives 记录')
  if (!after(row['created_at'], policy.roundStartedAt)) return fail('这条体检记录早于本轮测试开始时间，不算本轮证据')
  return { ok: true, manual: false, snapshot: { table: 'ad_health_narratives', row } }
}

async function runOf(db: SupabaseClient, runId: string) {
  const { data, error } = await db
    .from('action_runs')
    .select('id, client_id, action_key, status, created_at, finished_at')
    .eq('id', runId)
    .limit(1)
  if (error) return { error: true as const, row: null }
  return { error: false as const, row: ((data ?? [])[0] ?? null) as Record<string, unknown> | null }
}

const t3: Verifier = async (db, ref, policy) => {
  const runId = str(ref, 'runId')
  if (!runId || !UUID.test(runId)) return fail('T3 需要 runId（action_runs.id）')
  const { error, row } = await runOf(db, runId)
  if (error) return fail('读 action_runs 失败，无法核对')
  if (!row) return fail('生产库里没有这条 action_runs')
  if (row['client_id'] !== policy.targetClientId) return fail('这条动作不属于清单指定的目标客户')
  if (!String(row['action_key'] ?? '').startsWith('ads.')) return fail('这条动作不是 ads.* 动作')
  if (row['status'] !== 'succeeded') return fail(`这条动作的状态是 ${String(row['status'])}，不是 succeeded`)
  if (!after(row['finished_at'], policy.roundStartedAt)) return fail('这条动作早于本轮测试开始时间，不算本轮证据')
  return { ok: true, manual: false, snapshot: { table: 'action_runs', row } }
}

const t4: Verifier = async (db, ref, policy) => {
  const runId = str(ref, 'runId')
  if (!runId || !UUID.test(runId)) return fail('T4 需要 runId（与 T3 同一条）')
  const { error: runErr, row } = await runOf(db, runId)
  if (runErr) return fail('读 action_runs 失败，无法核对')
  if (!row || row['client_id'] !== policy.targetClientId) return fail('这条动作不存在或不属于目标客户')
  const { data, error } = await db
    .from('action_run_steps')
    .select('step_key, status, verification')
    .eq('run_id', runId)
  if (error) return fail('读 action_run_steps 失败，无法核对')
  const steps = (data ?? []) as Array<Record<string, unknown>>
  const ok = steps.find((s) => {
    const v = s['verification']
    return (
      String(s['step_key'] ?? '').toLowerCase().includes('readback') &&
      s['status'] === 'succeeded' &&
      v !== null &&
      typeof v === 'object' &&
      (v as Record<string, unknown>)['passed'] === true
    )
  })
  if (!ok) return fail('这条动作没有 succeeded 且 verification.passed 为 true 的 readback 步骤')
  return {
    ok: true,
    manual: false,
    snapshot: { table: 'action_run_steps', steps: steps.map((s) => ({ step_key: s['step_key'], status: s['status'] })) },
  }
}

const t5: Verifier = async (db, ref, policy) => {
  const runId = str(ref, 'runId')
  if (!runId || !UUID.test(runId)) return fail('T5 需要 runId（与 T3 同一条）')
  const { data, error } = await db
    .from('flywheel_actions')
    .select('id, client_id, action_run_id, action_type, executed_at')
    .eq('action_run_id', runId)
    .limit(5)
  if (error) return fail('读 flywheel_actions 失败，无法核对')
  const rows = ((data ?? []) as Array<Record<string, unknown>>).filter(
    (r) => r['client_id'] === policy.targetClientId && after(r['executed_at'], policy.roundStartedAt),
  )
  if (rows.length === 0) return fail('生产库里没有目标客户、本轮之后、对应这条动作的 flywheel_actions 回执行')
  return { ok: true, manual: false, snapshot: { table: 'flywheel_actions', rows } }
}

const MACHINE: Record<string, Verifier> = { T1: t1, T3: t3, T4: t4, T5: t5 }

/** 人工确认项：recordRef 回读“记录存在 + 目标客户 + 本轮之后”，description 原文留给签字人读。 */
async function manualCheck(
  db: SupabaseClient,
  item: ChecklistItem,
  ref: Record<string, unknown>,
  policy: Checklist['evidencePolicy'],
): Promise<EvidenceCheck> {
  const description = str(ref, 'description')
  if (!description || description.trim().length < 20) {
    return fail('人工确认项必须在 description 里写清楚看到了什么（至少 20 个字）')
  }
  const rec = ref['recordRef']
  const table = rec && typeof rec === 'object' ? (rec as Record<string, unknown>)['table'] : null
  const id = rec && typeof rec === 'object' ? (rec as Record<string, unknown>)['id'] : null
  if (typeof table !== 'string' || !MANUAL_TABLES.has(table) || typeof id !== 'string' || !UUID.test(id)) {
    return fail(`人工确认项必须带 recordRef {table, id}，table 只能是：${Array.from(MANUAL_TABLES).join('、')}`)
  }
  if (item.evidenceTables && !item.evidenceTables.includes(table)) {
    return fail(`${item.key} 的证据只能来自：${item.evidenceTables.join('、')}`)
  }
  const columns = table === 'authorization_decisions' ? 'id, client_id, created_at, verdict' : 'id, client_id, created_at'
  const { data, error } = await db.from(table).select(columns).eq('id', id).limit(1)
  if (error) return fail(`读 ${table} 失败，无法核对`)
  const row = (data ?? [])[0] as unknown as Record<string, unknown> | undefined
  if (!row) return fail(`生产库 ${table} 里没有这条记录`)
  // fail-closed：没有客户列/客户为空/客户不对，一律拒
  if (row['client_id'] !== policy.targetClientId) {
    return fail('这条记录不属于清单指定的目标客户')
  }
  if (table === 'authorization_decisions' && row['verdict'] === 'allow') {
    return fail('这条授权决定是“允许”，不是一次拒绝，不能作为“被拒绝”的证据')
  }
  if (!after(row['created_at'], policy.roundStartedAt)) return fail('这条记录早于本轮测试开始时间，不算本轮证据')
  return {
    ok: true,
    manual: true,
    snapshot: { manual: true, description: description.trim(), recordRef: { table, id } },
  }
}

export async function verifyEvidence(
  db: SupabaseClient,
  checklist: Checklist,
  item: ChecklistItem,
  ref: Record<string, unknown>,
): Promise<EvidenceCheck> {
  const policy = checklist.evidencePolicy
  if (!item.machineVerifiable) return manualCheck(db, item, ref, policy)
  const verifier = MACHINE[item.key]
  // 声明了可机器核对却没有核对器：宁可拒收，也不静默放行
  if (!verifier) return fail(`${item.key} 声明了可机器核对，但服务端还没有对应的核对器`)
  return verifier(db, ref, policy)
}
