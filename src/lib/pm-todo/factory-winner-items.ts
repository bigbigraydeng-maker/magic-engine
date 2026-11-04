/**
 * 今日待办「这条广告样板要不要认」（广告赢家闭环第 1 刀，设计稿 2026-11-05 §7）。
 *
 * 赢家 = 视频工厂以后出广告片照着学的那条片子。程序复核通过、还没人点「认 / 不认」的，进这一栏。
 * 复核没通过的（拿不到原视频等）不进：没人能认它，只在工厂页如实显示「现在不能用」。
 *
 * 注意力预算（设计 §7）：
 *   - 每个客户每周最多 1 条；
 *   - 一轮 7 天不回就过期；同一条候选最多再推 1 轮（共 2 轮）；之后不进待办，只留工厂页。
 * 推送记录合并写进该行 performance.todo_pushes（推送开始时间），不改表；写失败不挡待办出现。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { WINNER_COLUMNS, readProgramCheck, type ConfirmerDirectory, type WinnerRow } from '@/lib/factory/winner-gate'
import { boardStateOf, mergePerformance } from '@/lib/factory/winner-decision'

export type FactoryWinnerItemKind = 'factory_winner_confirm'

const MS_PER_DAY = 86_400_000
export const WINNER_TODO_ROUND_DAYS = 7
export const WINNER_TODO_MAX_ROUNDS = 2

/** 只用来判「有没有人决定过」；有决定的一律不进待办，所以不用真名单。 */
const NOBODY: ConfirmerDirectory = { isGlobalAdmin: () => false, staffEmails: new Set() }

export function winnerBoardUrl(clientId: string): string {
  return `https://app.magicengine.com.au/dashboard/factory?client=${clientId}#current-winner`
}

export interface WinnerConfirmTodo {
  client_id: string
  winner_id: string
  round: number
}

export interface WinnerTodoPlan {
  todos: WinnerConfirmTodo[]
  /** 新开一轮的：要把推送时间合并写回这一行 */
  newRounds: WinnerRow[]
}

function pushesOf(row: WinnerRow): number[] {
  const perf = row.performance
  const raw = typeof perf === 'object' && perf !== null && !Array.isArray(perf) ? (perf as Record<string, unknown>).todo_pushes : null
  if (!Array.isArray(raw)) return []
  return raw.map((v) => (typeof v === 'string' ? Date.parse(v) : NaN)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
}

type Candidate = { row: WinnerRow; pushes: number[]; checkedAt: number; live: boolean }

function candidateOf(row: WinnerRow, nowMs: number): Candidate | null {
  // needs_confirm 只会出现在「程序复核 passed、还没人决定」的行上（见 winner-gate.judgeWinner 的顺序）
  if (boardStateOf(row, nowMs, NOBODY).state !== 'needs_confirm') return null
  const check = readProgramCheck(row.performance)
  if (!check) return null
  const pushes = pushesOf(row)
  const last = pushes.length > 0 ? pushes[pushes.length - 1] : null
  const live = last !== null && nowMs - last < WINNER_TODO_ROUND_DAYS * MS_PER_DAY
  if (!live && pushes.length >= WINNER_TODO_MAX_ROUNDS) return null
  return { row, pushes, checkedAt: Date.parse(check.at), live }
}

/** 纯函数：今天哪些赢家进待办、哪些要新开一轮。每个客户最多一条。 */
export function planWinnerConfirmTodos(rows: readonly WinnerRow[], nowMs: number): WinnerTodoPlan {
  const byClient = new Map<string, Candidate[]>()
  for (const row of rows) {
    const c = candidateOf(row, nowMs)
    if (c) byClient.set(row.client_id, [...(byClient.get(row.client_id) ?? []), c])
  }
  const plan: WinnerTodoPlan = { todos: [], newRounds: [] }
  for (const [clientId, list] of byClient) {
    const live = list.find((c) => c.live)
    if (live) {
      plan.todos.push({ client_id: clientId, winner_id: live.row.id, round: live.pushes.length })
      continue
    }
    const pick = [...list].sort((a, b) => b.checkedAt - a.checkedAt)[0]
    plan.todos.push({ client_id: clientId, winner_id: pick.row.id, round: pick.pushes.length + 1 })
    plan.newRounds.push(pick.row)
  }
  return plan
}

export function buildWinnerConfirmItem(todo: WinnerConfirmTodo, clientName: string): ManualItem {
  const again = todo.round >= WINNER_TODO_MAX_ROUNDS ? '（上周提过一次，这是最后一轮提醒）' : ''
  return {
    kind: 'factory_winner_confirm',
    client_id: todo.client_id,
    client_name: clientName,
    what: `${clientName} 有一条跑得好的广告等你认：认了以后，视频工厂给这个客户做新广告片会照它的样子做。系统已复核过骨架。${again}`,
    how: `点链接看这条广告的截图和数据，点「认」或「不认」。${clientName} 自己的员工也可以点。不点也不会自动用它；这一轮 7 天后过期，最多再提醒一轮，之后只留在工厂页`,
    href: winnerBoardUrl(todo.client_id),
  }
}

export async function pushFactoryWinnerItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const { data, error } = await supabase.from('winner_structures').select(WINNER_COLUMNS).eq('status', 'active')
  if (error) throw new Error(`winner_structures query failed: ${error.message}`)
  const plan = planWinnerConfirmTodos((data ?? []) as WinnerRow[], now.getTime())
  const nowIso = now.toISOString()
  for (const row of plan.newRounds) {
    const prev = pushesOf(row).map((t) => new Date(t).toISOString())
    const saved = await mergePerformance(supabase, row, { todo_pushes: [...prev, nowIso] }, nowIso)
    if (!saved.ok) console.warn(`[factory-winner-items] 推送记录没写上（${row.id}）：${saved.error}`)
  }
  for (const todo of plan.todos) items.push(buildWinnerConfirmItem(todo, nameOf(todo.client_id)))
}
