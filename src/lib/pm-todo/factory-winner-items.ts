/**
 * 今日待办「这条广告样板要不要认」（广告赢家闭环第 1 刀，设计稿 2026-11-05 §7）。
 *
 * 赢家 = 视频工厂以后出广告片照着学的那条片子。复核过、还没人点「认 / 不认」的，进这一栏。
 * 注意力预算（拉模式、不写状态）：
 *   - 每个客户每天最多 1 条（挑复核最新的那条）；
 *   - 复核后 0–7 天推，7–14 天再推一次（「过期 7 天、同一候选最多再推 1 次」）；
 *   - 14 天后不进待办，只留在工厂页「当前赢家」一块等人点。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { WINNER_COLUMNS, readProgramCheck, type WinnerRow } from '@/lib/factory/winner-gate'
import { boardStateOf } from '@/lib/factory/winner-decision'

export type FactoryWinnerItemKind = 'factory_winner_confirm'

const MS_PER_DAY = 86_400_000
/** 复核后多少天内还会进待办（7 天一轮 + 再推一轮） */
export const WINNER_TODO_WINDOW_DAYS = 14

export function winnerBoardUrl(clientId: string): string {
  return `https://app.magicengine.com.au/dashboard/factory?client=${clientId}#current-winner`
}

export interface WinnerConfirmTodo {
  client_id: string
  winner_id: string
  needs_human_check: boolean
  round: 1 | 2
}

/** 纯函数：哪些赢家要进今天的待办。每个客户最多一条。 */
export function pickWinnerConfirmTodos(rows: readonly WinnerRow[], nowMs: number): WinnerConfirmTodo[] {
  const best = new Map<string, { todo: WinnerConfirmTodo; checkedAt: number }>()
  for (const row of rows) {
    if (boardStateOf(row, nowMs).state !== 'needs_confirm') continue
    const check = readProgramCheck(row.performance)
    if (!check) continue
    const checkedAt = Date.parse(check.at)
    const ageDays = (nowMs - checkedAt) / MS_PER_DAY
    if (ageDays < 0 || ageDays >= WINNER_TODO_WINDOW_DAYS) continue
    const todo: WinnerConfirmTodo = {
      client_id: row.client_id,
      winner_id: row.id,
      needs_human_check: check.state === 'needs_human',
      round: ageDays < 7 ? 1 : 2,
    }
    const prev = best.get(row.client_id)
    if (!prev || checkedAt > prev.checkedAt) best.set(row.client_id, { todo, checkedAt })
  }
  return Array.from(best.values()).map((b) => b.todo)
}

export function buildWinnerConfirmItem(todo: WinnerConfirmTodo, clientName: string): ManualItem {
  const check = todo.needs_human_check
    ? '系统没能自动复核完（拿不到原视频），要你看截图核一下骨架对不对。'
    : '系统已复核过骨架。'
  const again = todo.round === 2 ? '（上周提过一次，这是最后一次提醒）' : ''
  return {
    kind: 'factory_winner_confirm',
    client_id: todo.client_id,
    client_name: clientName,
    what: `有一条跑得好的广告等你认：认了以后，视频工厂做这个客户的新广告片会照它的样子做。${check}${again}`,
    how: '点链接看这条广告的截图和数据，点「认」或「不认」。CTS 员工也可以点。不点也不会自动用它；两周后这条不再提醒，仍留在工厂页',
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
  for (const todo of pickWinnerConfirmTodos((data ?? []) as WinnerRow[], now.getTime())) {
    items.push(buildWinnerConfirmItem(todo, nameOf(todo.client_id)))
  }
}
