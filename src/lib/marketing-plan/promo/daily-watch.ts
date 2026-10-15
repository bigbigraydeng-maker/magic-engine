/**
 * 推广计划每日检查 —— 纯函数。把一份计划的看板数据变成给 PM 的待办条目。
 * 每条都是大白话：发生了什么（what）+ 怎么办（how）。
 * 原则：没事就返回空数组，绝不返回「一切正常」类条目；看不清不等于正常。
 */

import type { PromoBoard } from './board'
import type { GateResult } from './gates'
import { formatRowValue } from './labels'
import type { ReconcileRow } from './reconcile'

export type WatchCode =
  | 'draft_ready_to_approve'   // 草稿已排好、检查清单全过，等 PM 批准
  | 'approved_content_changed' // 批准之后内容被改过，自动执行已停
  | 'phase_gate_failed'        // 已批准计划里，到期阶段的硬检查没过
  | 'reconcile_deviation'      // 本周对账：落后或超出
  | 'reconcile_blind'          // 本周对账：看不清（没读到 / 没接通）

export interface WatchFinding {
  code: WatchCode
  what: string
  how: string
}

/** 把 ISO 时间截成「YYYY-MM-DD HH:MM」，把 T 换成空格。 */
function shortTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

/** 一条 blocker 的展示文案：阶段名 + 标签 + 原因。 */
function blockerText(b: GateResult): string {
  const prefix = b.phase_name ? `${b.phase_name}：` : ''
  return `${prefix}${b.label}（${b.reason}）`
}

/** 一条对账行的展示文案：计划值 / 实际值 / 原因 / 取数时间。 */
function deviationText(row: ReconcileRow): string {
  const planned = formatRowValue(row, row.planned)
  const actual = formatRowValue(row, row.actual)
  const asOf = row.as_of ? `取数时间 ${shortTime(row.as_of)}` : '没有取数时间'
  let text = `${row.label}：计划 ${planned}、实际 ${actual}（${row.reason}；${asOf}）`
  if (row.key === 'content' && row.actual === 0 && row.planned !== null && row.planned > 0) {
    text += ' 读到 0 条——这里分不清是真的一条没发，还是发布记录没接通，先别直接当成没发。'
  }
  return text
}

/** 最多取前 n 条，超出时补一句「等共 N 项」。 */
function takeWithOverflow(items: string[], n: number): string {
  if (items.length <= n) return items.join('；')
  return `${items.slice(0, n).join('；')}等共 ${items.length} 项`
}

export function detectWatchFindings(board: PromoBoard, plan: { title: string }): WatchFinding[] {
  // 1. 没有推广结构或结构不合法：不是这个检查管的事
  if (!board.has_promo || !board.spec_valid) return []

  const title = plan.title
  const findings: WatchFinding[] = []

  // 2. 草稿：检查清单全过 → 等 PM 批准
  if (board.plan_status === 'draft') {
    if (board.approval?.can_approve === true) {
      const n = board.approval.unverified.length
      const extra = n > 0 ? ` 另有 ${n} 项还没核实，建议先问清楚再批。` : ''
      findings.push({
        code: 'draft_ready_to_approve',
        what: `推广计划《${title}》已经排好，批准前的检查清单都过了，等你批准。批准后只会派出内部待办，不会自动投放广告。${extra}`,
        how: '打开推广计划页，看一眼阶段、预算和依据，没问题就点「批准计划」。真正开投仍然要你本人另外点头。',
      })
    }
    return findings
  }

  // 3. 已批准
  if (board.plan_status === 'approved') {
    // a. 批准之后内容被改过
    if (board.content_changed === true) {
      findings.push({
        code: 'approved_content_changed',
        what: `推广计划《${title}》批准之后内容被改过，批准的已经不是现在这一版，系统已经停止依据它自动执行。`,
        how: '打开推广计划页，把计划退回草稿、确认内容、再重新批准。',
      })
    }

    // b. 到期阶段的硬检查没过
    if (board.approval && board.approval.blockers.length > 0) {
      const blockers = board.approval.blockers
      const first = blockers[0]
      findings.push({
        code: 'phase_gate_failed',
        what: `推广计划《${title}》里，马上要开始的阶段有检查没过：${takeWithOverflow(blockers.map(blockerText), 3)}`,
        how: first.how || '打开推广计划页，按页面上每一项后面的「怎么办」处理。',
      })
    }

    // c. 本周对账
    if (board.reconcile) {
      const rows = board.reconcile.rows
      const bad = rows.filter(r => r.status === 'behind' || r.status === 'over')
      if (bad.length > 0) {
        findings.push({
          code: 'reconcile_deviation',
          what: `推广计划《${title}》本周对账有偏差：${takeWithOverflow(bad.map(deviationText), 3)}`,
          how: '打开推广计划页看对账表；要调预算或节奏，告诉我，调整后需要你重新批准。',
        })
      }

      const unknown = rows.filter(r => r.status === 'unknown')
      if (unknown.length > 0 || board.reconcile.blind === true) {
        const parts = unknown.slice(0, 3).map(r => `${r.label}——${r.reason}`)
        const detail = parts.length > 0 ? `${parts.join('；')} ` : ''
        findings.push({
          code: 'reconcile_blind',
          what: `推广计划《${title}》本周对账看不清：${detail}看不清不等于正常，也不等于 0。`,
          how: '先查数据有没有进来（页面上每一行都写了取数时间）；数据通道断了的话告诉开发。',
        })
      }
    }

    return findings
  }

  // 4. 其它状态（completed / archived）
  return []
}
