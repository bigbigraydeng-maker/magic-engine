/**
 * 赢家闸：工厂只认「程序复核通过 + 有权的人点过认」的赢家（设计稿 2026-11-05 §3.3，第 1 刀）。
 *
 * 照赢家出片（pickWinner）只许拿 `usableWinnerSlices` 的结果（evaluate.ts 读一次行、同一批行再算题材护栏），不许各自查表。
 * 判定是关闭即失败：缺键、解析失败、取值不在固定集合、复核不是 passed、确认人对不上 = 不可用。
 * （「别撞在跑赢家的题材」那道护栏不走这道闸，读全部 status=active 的行，见 evaluate.ts。）
 *
 * 状态存在 `performance` 的几段里，分开写互不覆盖：
 *   program_check        = { state, at, reason? }                    程序复核结论（只有 passed 算过）
 *   pm_decision          = { decision, by, role, event_id, at }      最新一次人的决定（即确认回执）
 *   pm_decision_history  = PmDecision[]                              之前的决定，只追加
 *   cost_per_result + result_type                                    该广告组自己结果种类的单次成本
 *   pm_only_required     = { by, at, reason }                         PM 推翻员工认过的赢家时随决定一起写（和决定同一次带锁写入）
 * 「只认 PM」= 客户配置 winner_confirm_pm_only，或该客户任何一条赢家带 pm_only_required：员工确认的一律不算。
 * 确认人在读取时再核一次：magic_lab 必须是全局管理员；client_staff 必须在该客户的员工名单里。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { ACCESS_TYPES_CUSTOMER_ONLY } from '@/lib/auth/access-types'
import type { WinnerSlice } from './types'

export const PROGRAM_CHECK_STATES = ['passed', 'needs_human', 'failed'] as const
export type ProgramCheckState = (typeof PROGRAM_CHECK_STATES)[number]

export const PM_DECISIONS = ['approved', 'rejected'] as const
export type PmDecisionValue = (typeof PM_DECISIONS)[number]

export const CONFIRMER_ROLES = ['magic_lab', 'client_staff'] as const
export type ConfirmerRole = (typeof CONFIRMER_ROLES)[number]

/** 与 ads-strategy/rules/core-metric.ts 的 CoreMetric 同一份取值（测试锁住两边一致，工厂不反向依赖广告策略目录） */
export const WINNER_RESULT_TYPES = ['lead', 'messaging_started'] as const
export type WinnerResultType = (typeof WINNER_RESULT_TYPES)[number]

export type WinnerUnusableReason =
  | 'not_active'
  | 'performance_unreadable'
  | 'program_check_missing'
  | 'program_check_not_passed'
  | 'pm_decision_missing'
  | 'pm_decision_rejected'
  | 'receipt_invalid'
  | 'confirmer_not_authorized'
  | 'result_type_unknown'
  | 'cost_per_result_missing'

export type WinnerVerdict =
  | { usable: true; costPerResult: number; resultType: WinnerResultType }
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
}

/** 谁有权确认：magic_lab 查全局管理员名单；client_staff 查该客户员工邮箱（已小写） */
export interface ConfirmerDirectory {
  isGlobalAdmin: (email: string) => boolean
  staffEmails: ReadonlySet<string>
  /** 这个客户目前只认 PM：员工确认的一律判不可用（设计 §4「之后只认 PM」） */
  pmOnly: boolean
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

/** requireGlobalAdmin 背后的同一判据：内部管理员且不限定客户（DEMO_ADMINS / 受限管理员不算）。 */
export function isGlobalAdminByEmail(email: string): boolean {
  const perms = getUserPermissions(email)
  return perms !== null && perms.role === 'admin' && perms.allowedClientId === null
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

export function parsePmDecision(value: unknown): PmDecision | null {
  if (!isRecord(value)) return null
  const decision = oneOf(value.decision, PM_DECISIONS)
  const role = oneOf(value.role, CONFIRMER_ROLES)
  const at = isoOrNull(value.at)
  if (!decision || !role || !at) return null
  if (typeof value.by !== 'string' || !value.by.includes('@')) return null
  if (typeof value.event_id !== 'string') return null
  return { decision, by: value.by, role, event_id: value.event_id, at }
}

export function readPmDecision(performance: unknown): PmDecision | null {
  return isRecord(performance) ? parsePmDecision(performance.pm_decision) : null
}

export function readCostPerResult(performance: unknown): number | null {
  if (!isRecord(performance)) return null
  const v = performance.cost_per_result
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

export function readResultType(performance: unknown): WinnerResultType | null {
  return isRecord(performance) ? oneOf(performance.result_type, WINNER_RESULT_TYPES) : null
}

/** 回执对得上：事件编号必须由这条赢家、这个决定、这个时间算出来；时间不能在未来。 */
export function receiptMatches(winnerId: string, d: PmDecision, nowMs: number): boolean {
  if (d.event_id !== winnerDecisionEventId(winnerId, d.decision, d.at)) return false
  return Date.parse(d.at) <= nowMs + 5 * 60_000
}

/** 点认的人现在还有没有这个资格（换了岗位 / 被移出名单的，之前认的也不算）。 */
export function confirmerAuthorized(d: PmDecision, dir: ConfirmerDirectory): boolean {
  const email = d.by.toLowerCase().trim()
  if (d.role === 'magic_lab') return dir.isGlobalAdmin(email)
  if (dir.pmOnly) return false
  return !dir.isGlobalAdmin(email) && dir.staffEmails.has(email)
}

export function judgeWinner(
  row: Pick<WinnerRow, 'id' | 'status' | 'performance'>,
  nowMs: number,
  dir: ConfirmerDirectory,
): WinnerVerdict {
  if (row.status !== 'active') return { usable: false, reason: 'not_active' }
  if (!isRecord(row.performance)) return { usable: false, reason: 'performance_unreadable' }
  const check = readProgramCheck(row.performance)
  if (!check) return { usable: false, reason: 'program_check_missing' }
  if (check.state !== 'passed') return { usable: false, reason: 'program_check_not_passed' }
  const decision = readPmDecision(row.performance)
  if (!decision) return { usable: false, reason: 'pm_decision_missing' }
  if (!receiptMatches(row.id, decision, nowMs)) return { usable: false, reason: 'receipt_invalid' }
  if (!confirmerAuthorized(decision, dir)) return { usable: false, reason: 'confirmer_not_authorized' }
  if (decision.decision !== 'approved') return { usable: false, reason: 'pm_decision_rejected' }
  const resultType = readResultType(row.performance)
  if (!resultType) return { usable: false, reason: 'result_type_unknown' }
  const cost = readCostPerResult(row.performance)
  if (cost === null) return { usable: false, reason: 'cost_per_result_missing' }
  return { usable: true, costPerResult: cost, resultType }
}

export const WINNER_COLUMNS =
  'id, client_id, status, performance, hook_segment, middle_segment, cta_segment, win_reason_tags, cost_per_thruplay, current_frequency, updated_at'

export async function loadWinnerRows(sb: SupabaseClient, clientId: string): Promise<WinnerRow[]> {
  const { data, error } = await sb.from('winner_structures').select(WINNER_COLUMNS).eq('client_id', clientId)
  if (error) throw new Error(`winner_structures query failed: ${error.message}`)
  return (data ?? []) as WinnerRow[]
}

/** 该客户的员工邮箱（只认客户自己的人：client / dashboard / both，排除受限管理员）。读不出就抛，调用方关闭即失败。 */
export async function loadStaffEmails(sb: SupabaseClient, clientId: string): Promise<Set<string>> {
  const { data, error } = await sb
    .from('client_portal_users')
    .select('email, access_type, scoped_admin')
    .eq('client_id', clientId)
    .in('access_type', ACCESS_TYPES_CUSTOMER_ONLY as readonly string[] as string[])
  if (error) throw new Error(`client_portal_users query failed: ${error.message}`)
  const out = new Set<string>()
  for (const r of data ?? []) {
    const row = r as { email?: unknown; scoped_admin?: unknown }
    if (row.scoped_admin === true || typeof row.email !== 'string') continue
    out.add(row.email.toLowerCase().trim())
  }
  return out
}

/** 这个客户是不是只认 PM：客户配置的开关，或该客户任何一条赢家带 pm_only_required 标记。 */
export function pmOnlyFrom(rows: readonly Pick<WinnerRow, 'performance'>[], factoryConfig: unknown): boolean {
  if (confirmIsPmOnly(factoryConfig)) return true
  return rows.some((r) => isRecord(r.performance) && isRecord(r.performance.pm_only_required))
}

async function loadFactoryConfig(sb: SupabaseClient, clientId: string): Promise<unknown> {
  const { data, error } = await sb.from('clients').select('factory_config').eq('id', clientId).maybeSingle()
  if (error) throw new Error(`clients query failed: ${error.message}`)
  return data?.factory_config ?? null
}

export async function loadConfirmerDirectory(
  sb: SupabaseClient,
  clientId: string,
  rows: readonly Pick<WinnerRow, 'performance'>[],
): Promise<ConfirmerDirectory> {
  const [staffEmails, cfg] = await Promise.all([loadStaffEmails(sb, clientId), loadFactoryConfig(sb, clientId)])
  return { isGlobalAdmin: isGlobalAdminByEmail, staffEmails, pmOnly: pmOnlyFrom(rows, cfg) }
}

/** 该客户当前是不是只认 PM（决定接口用；读不出就抛，调用方按拒绝处理）。 */
export async function loadPmOnly(sb: SupabaseClient, clientId: string): Promise<{ pmOnly: boolean; configFlag: boolean }> {
  const [rows, cfg] = await Promise.all([loadWinnerRows(sb, clientId), loadFactoryConfig(sb, clientId)])
  return { pmOnly: pmOnlyFrom(rows, cfg), configFlag: confirmIsPmOnly(cfg) }
}

export function usableWinnerSlices(rows: readonly WinnerRow[], nowMs: number, dir: ConfirmerDirectory): WinnerSlice[] {
  const out: WinnerSlice[] = []
  for (const row of rows) {
    const verdict = judgeWinner(row, nowMs, dir)
    if (!verdict.usable) continue
    out.push({
      id: row.id,
      hook_segment: row.hook_segment,
      middle_segment: row.middle_segment,
      cta_segment: row.cta_segment,
      win_reason_tags: row.win_reason_tags ?? [],
      cost_per_thruplay: row.cost_per_thruplay,
      cost_per_result: verdict.costPerResult,
      result_type: verdict.resultType,
      current_frequency: row.current_frequency,
      status: row.status,
    })
  }
  return out.sort((a, b) => a.result_type.localeCompare(b.result_type) || a.cost_per_result - b.cost_per_result)
}

/** PM 推翻一次员工认过的赢家 → 该客户回到只认 PM（设计稿 §4 降级规则）。 */
export function shouldRevertToPmOnly(previous: PmDecision | null, next: Pick<PmDecision, 'decision' | 'role'>): boolean {
  return previous !== null
    && previous.decision === 'approved'
    && previous.role === 'client_staff'
    && next.role === 'magic_lab'
    && next.decision === 'rejected'
}

/** 员工不能改 Magic Lab 定下的决定。 */
export function staffCannotOverride(previous: PmDecision | null, nextRole: ConfirmerRole): boolean {
  return previous !== null && previous.role === 'magic_lab' && nextRole === 'client_staff'
}

/** factory_config.winner_confirm_pm_only：true = 只有 Magic Lab 内部账号能点认。 */
export function confirmIsPmOnly(factoryConfig: unknown): boolean {
  return isRecord(factoryConfig) && factoryConfig.winner_confirm_pm_only === true
}
