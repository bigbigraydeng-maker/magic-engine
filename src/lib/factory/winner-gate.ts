/**
 * 赢家闸：工厂只认「程序复核过 + 有权的人点过认」的赢家（设计稿 2026-11-05 §3.3，第 1 刀）。
 *
 * 所有读 winner_structures 去下单 / 出片的入口只许调 `loadUsableWinners`，不许各自查表。
 * 判定是关闭即失败：缺键、解析失败、取值不在固定集合 = 不可用。
 *
 * 状态存在 `performance` 的两段里，分开写互不覆盖：
 *   program_check = { state, at, reason?, frames_checked? }      程序复核结论
 *   pm_decision   = { decision, by, role, event_id, at, acknowledged_check_state }  人的决定（即确认回执）
 * 排序用 `performance.cost_per_result`（该广告组自己结果种类的单次成本）；缺这个数 = 不可用。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WinnerSlice } from './types'

export const PROGRAM_CHECK_STATES = ['passed', 'needs_human', 'failed'] as const
export type ProgramCheckState = (typeof PROGRAM_CHECK_STATES)[number]

export const PM_DECISIONS = ['approved', 'rejected'] as const
export type PmDecisionValue = (typeof PM_DECISIONS)[number]

export const CONFIRMER_ROLES = ['magic_lab', 'client_staff'] as const
export type ConfirmerRole = (typeof CONFIRMER_ROLES)[number]

export type WinnerUnusableReason =
  | 'not_active'
  | 'performance_unreadable'
  | 'program_check_missing'
  | 'program_check_failed'
  | 'pm_decision_missing'
  | 'pm_decision_rejected'
  | 'receipt_invalid'
  | 'human_check_not_acknowledged'
  | 'cost_per_result_missing'

export type WinnerVerdict =
  | { usable: true; costPerResult: number }
  | { usable: false; reason: WinnerUnusableReason }

export interface ProgramCheck {
  state: ProgramCheckState
  at: string
  reason: string | null
}

export interface PmDecision {
  decision: PmDecisionValue
  by: string
  role: ConfirmerRole
  event_id: string
  at: string
  /** 点「认」时看到的复核状态；复核没过（needs_human）时，人看过截图点认才算数 */
  acknowledged_check_state: ProgramCheckState
}

export interface WinnerRow {
  id: string
  client_id: string
  status: string
  performance: unknown
  hook_segment: Record<string, unknown>
  middle_segment: Record<string, unknown>
  cta_segment: Record<string, unknown>
  win_reason_tags: string[]
  cost_per_thruplay: number | null
  current_frequency: number | null
  updated_at: string
}

/** 回执里写的事件编号：同一次决定只有这一个编号，界面和 Inngest 用同一个。 */
export function winnerDecisionEventId(winnerId: string, decision: PmDecisionValue, at: string): string {
  return `factory.winner.${decision}:${winnerId}:${at}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

export function readProgramCheck(performance: unknown): ProgramCheck | null {
  if (!isRecord(performance) || !isRecord(performance.program_check)) return null
  const pc = performance.program_check
  const state = oneOf(pc.state, PROGRAM_CHECK_STATES)
  const at = isoOrNull(pc.at)
  if (!state || !at) return null
  return { state, at, reason: typeof pc.reason === 'string' ? pc.reason : null }
}

export function readPmDecision(performance: unknown): PmDecision | null {
  if (!isRecord(performance) || !isRecord(performance.pm_decision)) return null
  const d = performance.pm_decision
  const decision = oneOf(d.decision, PM_DECISIONS)
  const role = oneOf(d.role, CONFIRMER_ROLES)
  const ack = oneOf(d.acknowledged_check_state, PROGRAM_CHECK_STATES)
  const at = isoOrNull(d.at)
  if (!decision || !role || !ack || !at) return null
  if (typeof d.by !== 'string' || !d.by.includes('@')) return null
  if (typeof d.event_id !== 'string') return null
  return { decision, by: d.by, role, event_id: d.event_id, at, acknowledged_check_state: ack }
}

export function readCostPerResult(performance: unknown): number | null {
  if (!isRecord(performance)) return null
  const v = performance.cost_per_result
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/** 回执对得上：事件编号必须由这条赢家、这个决定、这个时间算出来；时间不能在未来。 */
export function receiptMatches(winnerId: string, d: PmDecision, nowMs: number): boolean {
  if (d.event_id !== winnerDecisionEventId(winnerId, d.decision, d.at)) return false
  return Date.parse(d.at) <= nowMs + 5 * 60_000
}

export function judgeWinner(row: Pick<WinnerRow, 'id' | 'status' | 'performance'>, nowMs: number): WinnerVerdict {
  if (row.status !== 'active') return { usable: false, reason: 'not_active' }
  if (!isRecord(row.performance)) return { usable: false, reason: 'performance_unreadable' }
  const check = readProgramCheck(row.performance)
  if (!check) return { usable: false, reason: 'program_check_missing' }
  if (check.state === 'failed') return { usable: false, reason: 'program_check_failed' }
  const decision = readPmDecision(row.performance)
  if (!decision) return { usable: false, reason: 'pm_decision_missing' }
  if (!receiptMatches(row.id, decision, nowMs)) return { usable: false, reason: 'receipt_invalid' }
  if (decision.decision !== 'approved') return { usable: false, reason: 'pm_decision_rejected' }
  if (check.state === 'needs_human' && decision.acknowledged_check_state !== 'needs_human') {
    return { usable: false, reason: 'human_check_not_acknowledged' }
  }
  const cost = readCostPerResult(row.performance)
  if (cost === null) return { usable: false, reason: 'cost_per_result_missing' }
  return { usable: true, costPerResult: cost }
}

export const WINNER_COLUMNS =
  'id, client_id, status, performance, hook_segment, middle_segment, cta_segment, win_reason_tags, cost_per_thruplay, current_frequency, updated_at'

export async function loadWinnerRows(sb: SupabaseClient, clientId: string): Promise<WinnerRow[]> {
  const { data, error } = await sb.from('winner_structures').select(WINNER_COLUMNS).eq('client_id', clientId)
  if (error) throw new Error(`winner_structures query failed: ${error.message}`)
  return (data ?? []) as WinnerRow[]
}

/** 下单 / 出片唯一入口：只返回可用赢家，按单次成本从低到高。 */
export async function loadUsableWinners(sb: SupabaseClient, clientId: string, now: Date = new Date()): Promise<WinnerSlice[]> {
  const rows = await loadWinnerRows(sb, clientId)
  return usableWinnerSlices(rows, now.getTime())
}

export function usableWinnerSlices(rows: readonly WinnerRow[], nowMs: number): WinnerSlice[] {
  const out: WinnerSlice[] = []
  for (const row of rows) {
    const verdict = judgeWinner(row, nowMs)
    if (!verdict.usable) continue
    out.push({
      id: row.id,
      hook_segment: row.hook_segment,
      middle_segment: row.middle_segment,
      cta_segment: row.cta_segment,
      win_reason_tags: row.win_reason_tags ?? [],
      cost_per_thruplay: row.cost_per_thruplay,
      cost_per_result: verdict.costPerResult,
      current_frequency: row.current_frequency,
      status: row.status,
    })
  }
  return out.sort((a, b) => a.cost_per_result - b.cost_per_result)
}

/** PM 推翻一次员工认过的赢家 → 该客户回到只认 PM（第 1 刀只给判定，不自动写配置）。 */
export function shouldRevertToPmOnly(previous: PmDecision | null, next: Pick<PmDecision, 'decision' | 'role'>): boolean {
  return previous !== null
    && previous.decision === 'approved'
    && previous.role === 'client_staff'
    && next.role === 'magic_lab'
    && next.decision === 'rejected'
}

/** factory_config.winner_confirm_pm_only：true = 只有 Magic Lab 内部账号能点认。 */
export function confirmIsPmOnly(factoryConfig: unknown): boolean {
  return isRecord(factoryConfig) && factoryConfig.winner_confirm_pm_only === true
}
