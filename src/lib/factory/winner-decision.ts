/**
 * 赢家的「认 / 不认」与后台看板（设计稿 2026-11-05 §3.3 / §4，第 1 刀）。
 *
 * 写 performance 只动指定的几段（pm_decision / pm_decision_history / program_check / frames / todo_pushes），
 * 用 updated_at 做乐观锁：读到哪一版就只在那一版上改，中间被别人改过就拒（409），不整块覆盖。
 * winner_structures 表上没有自动更新 updated_at 的触发器，所以每次写都手工带上新的 updated_at。
 * （真正的 SQL `jsonb ||` 要新建数据库函数 = 迁移 = A 级，第 1 刀不碰。）
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import {
  WINNER_COLUMNS,
  judgeWinner,
  loadConfirmerDirectory,
  loadWinnerRows,
  parsePmDecision,
  readPmDecision,
  readProgramCheck,
  shouldRevertToPmOnly,
  staffCannotOverride,
  winnerDecisionEventId,
  type ConfirmerDirectory,
  type ConfirmerRole,
  type PmDecision,
  type PmDecisionValue,
  type ProgramCheck,
  type WinnerRow,
  type WinnerUnusableReason,
} from './winner-gate'

export const WINNER_EVENT_CONFIRMED = 'factory.winner.confirmed'
export const WINNER_EVENT_REJECTED = 'factory.winner.rejected'
const HISTORY_MAX = 20

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type PerformanceKey = 'pm_decision' | 'pm_decision_history' | 'program_check' | 'frames' | 'todo_pushes'

/** 只改 performance 里指定的几段；updated_at 对不上 = 中间被改过，返回 409。 */
export async function mergePerformance(
  sb: SupabaseClient,
  row: Pick<WinnerRow, 'id' | 'performance' | 'updated_at'>,
  patch: Partial<Record<PerformanceKey, unknown>>,
  nowIso: string,
): Promise<Result<{ updated_at: string }>> {
  const base = isRecord(row.performance) ? row.performance : {}
  const next = { ...base, ...patch }
  const { data, error } = await sb
    .from('winner_structures')
    .update({ performance: next, updated_at: nowIso })
    .eq('id', row.id)
    .eq('updated_at', row.updated_at)
    .select('id')
  if (error) return { ok: false, status: 500, error: `winner update failed: ${error.message}` }
  if (!data || data.length !== 1) return { ok: false, status: 409, error: '这条赢家刚被别处改过，请刷新后再点' }
  return { ok: true, data: { updated_at: nowIso } }
}

export async function loadWinnerRow(sb: SupabaseClient, winnerId: string): Promise<Result<WinnerRow>> {
  const { data, error } = await sb.from('winner_structures').select(WINNER_COLUMNS).eq('id', winnerId).maybeSingle()
  if (error) return { ok: false, status: 500, error: `winner_structures query failed: ${error.message}` }
  if (!data) return { ok: false, status: 404, error: 'winner not found' }
  return { ok: true, data: data as WinnerRow }
}

export interface DecisionInput {
  winnerId: string
  decision: PmDecisionValue
  by: string
  role: ConfirmerRole
  now: Date
  send?: typeof sendInngestEvent
}

export interface DecisionReceipt {
  request_id: string
  client_id: string
  winner_id: string
  status: PmDecisionValue
  by: string
  role: ConfirmerRole
  created_at: string
  cost_usd: number
  event_sent: boolean
  event_error: string | null
  /** PM 推翻员工认过的赢家 → 已把该客户改成只认 PM（设计稿 §4） */
  pm_only_written: boolean
  pm_only_error: string | null
}

function historyOf(performance: unknown, previous: PmDecision | null): PmDecision[] {
  const raw = isRecord(performance) && Array.isArray(performance.pm_decision_history) ? performance.pm_decision_history : []
  const kept = raw.map(parsePmDecision).filter((d): d is PmDecision => d !== null)
  return (previous ? [...kept, previous] : kept).slice(-HISTORY_MAX)
}

function precheck(row: WinnerRow, previous: PmDecision | null, input: DecisionInput): Result<ProgramCheck> {
  const check = readProgramCheck(row.performance)
  if (!check || check.state !== 'passed') {
    return { ok: false, status: 409, error: '这条赢家程序复核还没通过，现在不能认' }
  }
  if (staffCannotOverride(previous, input.role)) {
    return { ok: false, status: 403, error: '这条是 Magic Lab 定的，员工改不了；要改请找 PM' }
  }
  return { ok: true, data: check }
}

/** 点「认 / 不认」：写回执进 pm_decision、旧决定进历史，再发一条业务可读的 Inngest 事件。 */
export async function recordWinnerDecision(sb: SupabaseClient, input: DecisionInput): Promise<Result<DecisionReceipt>> {
  const loaded = await loadWinnerRow(sb, input.winnerId)
  if (!loaded.ok) return loaded
  const row = loaded.data
  const previous = readPmDecision(row.performance)
  const pre = precheck(row, previous, input)
  if (!pre.ok) return pre
  const at = input.now.toISOString()
  const decision: PmDecision = {
    decision: input.decision,
    by: input.by,
    role: input.role,
    event_id: winnerDecisionEventId(row.id, input.decision, at),
    at,
  }
  const written = await mergePerformance(sb, row, { pm_decision: decision, pm_decision_history: historyOf(row.performance, previous) }, at)
  if (!written.ok) return written
  const pmOnly = shouldRevertToPmOnly(previous, decision)
    ? await writePmOnly(sb, row, decision)
    : { written: false, error: null }
  const sent = await emitDecisionEvent(row, decision, input.send ?? sendInngestEvent)
  return {
    ok: true,
    data: {
      request_id: decision.event_id,
      client_id: row.client_id,
      winner_id: row.id,
      status: input.decision,
      by: input.by,
      role: input.role,
      created_at: at,
      cost_usd: 0,
      event_sent: sent === null,
      event_error: sent,
      pm_only_written: pmOnly.written,
      pm_only_error: pmOnly.error,
    },
  }
}

/** 把客户配置改成只认 PM：比对整份原配置再写（别处刚改过就不写，回执里说明）。 */
async function writePmOnly(sb: SupabaseClient, row: WinnerRow, d: PmDecision): Promise<{ written: boolean; error: string | null }> {
  const { data, error } = await sb.from('clients').select('factory_config').eq('id', row.client_id).maybeSingle()
  if (error || !data) return { written: false, error: error?.message ?? 'client not found' }
  const cfg = isRecord(data.factory_config) ? data.factory_config : {}
  const next = {
    ...cfg,
    winner_confirm_pm_only: true,
    winner_confirm_pm_only_receipt: { by: d.by, at: d.at, winner_id: row.id, event_id: d.event_id, reason: 'pm_overturned_staff_approval' },
  }
  let update = sb.from('clients').update({ factory_config: next }).eq('id', row.client_id)
  update = data.factory_config === null ? update.is('factory_config', null) : update.filter('factory_config', 'eq', JSON.stringify(data.factory_config))
  const saved = await update.select('id')
  if (saved.error) return { written: false, error: saved.error.message }
  if (!saved.data || saved.data.length !== 1) return { written: false, error: 'factory_config changed concurrently' }
  return { written: true, error: null }
}

async function emitDecisionEvent(row: WinnerRow, d: PmDecision, send: typeof sendInngestEvent): Promise<string | null> {
  try {
    await send({
      id: d.event_id,
      name: d.decision === 'approved' ? WINNER_EVENT_CONFIRMED : WINNER_EVENT_REJECTED,
      data: {
        request_id: d.event_id,
        client_id: row.client_id,
        winner_id: row.id,
        status: d.decision,
        by: d.by,
        role: d.role,
        created_at: d.at,
        cost_usd: 0,
        provider_impact: 'none',
        no_publish: true,
      },
    })
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// ── 后台看板 ───────────────────────────────────────────────────────────────

export type WinnerBoardState = 'needs_check' | 'needs_confirm' | 'confirmed' | 'unusable'

export interface WinnerBoardItem {
  id: string
  state: WinnerBoardState
  reason: WinnerUnusableReason | null
  hook: string
  middle: string
  cta: string
  tags: string[]
  performance: { spend: number | null; results: number | null; cost_per_result: number | null; ctr_pct: number | null; period: string | null }
  frames: string[]
  program_check: ProgramCheck | null
  decision: PmDecision | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function text(v: unknown): string {
  return isRecord(v) && typeof v.description === 'string' ? v.description : ''
}

export function boardStateOf(row: WinnerRow, nowMs: number, dir: ConfirmerDirectory): { state: WinnerBoardState; reason: WinnerUnusableReason | null } {
  const verdict = judgeWinner(row, nowMs, dir)
  if (verdict.usable) return { state: 'confirmed', reason: null }
  if (verdict.reason === 'program_check_missing') return { state: 'needs_check', reason: verdict.reason }
  if (verdict.reason === 'pm_decision_missing') return { state: 'needs_confirm', reason: verdict.reason }
  return { state: 'unusable', reason: verdict.reason }
}

export function toBoardItem(row: WinnerRow, nowMs: number, dir: ConfirmerDirectory): WinnerBoardItem {
  const perf = isRecord(row.performance) ? row.performance : {}
  const { state, reason } = boardStateOf(row, nowMs, dir)
  return {
    id: row.id,
    state,
    reason,
    hook: text(row.hook_segment),
    middle: text(row.middle_segment),
    cta: text(row.cta_segment),
    tags: row.win_reason_tags ?? [],
    performance: {
      spend: num(perf.spend_nzd),
      results: num(perf.leads),
      cost_per_result: num(perf.cost_per_result),
      ctr_pct: num(perf.ctr_pct),
      period: typeof perf.period === 'string' ? perf.period : null,
    },
    frames: Array.isArray(perf.frames) ? perf.frames.filter((f): f is string => typeof f === 'string') : [],
    program_check: readProgramCheck(row.performance),
    decision: readPmDecision(row.performance),
  }
}

export async function loadWinnerBoard(sb: SupabaseClient, clientId: string, now: Date = new Date()): Promise<WinnerBoardItem[]> {
  const [rows, dir] = await Promise.all([loadWinnerRows(sb, clientId), loadConfirmerDirectory(sb, clientId)])
  return rows.filter((r) => r.status === 'active').map((r) => toBoardItem(r, now.getTime(), dir))
}
