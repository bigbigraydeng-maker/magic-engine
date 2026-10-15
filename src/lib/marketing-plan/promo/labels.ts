/**
 * 页面用的中文文案与按钮状态（纯函数，可测试）。
 * 原则：PM 看不到任何内部词；灰色必须有文字说明，不能只靠颜色区分。
 */

import type { GateResult, Light } from './gates'
import type { RowStatus, ReconcileRow } from './reconcile'
import type { PromoBoard } from './board'

export const LIGHT_META: Record<Light, { dot: string; label: string; cls: string }> = {
  green: { dot: '🟢', label: '通过', cls: 'text-green-700 bg-green-50 border-green-200' },
  yellow: { dot: '🟡', label: '有风险', cls: 'text-yellow-800 bg-yellow-50 border-yellow-200' },
  red: { dot: '🔴', label: '没过', cls: 'text-red-700 bg-red-50 border-red-200' },
  gray: { dot: '⚪', label: '还没核实', cls: 'text-gray-600 bg-gray-100 border-gray-300' },
}

export const ROW_STATUS_META: Record<RowStatus, { label: string; cls: string }> = {
  on_track: { label: '正常', cls: 'text-green-700 bg-green-50 border-green-200' },
  behind: { label: '落后', cls: 'text-red-700 bg-red-50 border-red-200' },
  over: { label: '超出', cls: 'text-red-700 bg-red-50 border-red-200' },
  unknown: { label: '看不清', cls: 'text-gray-600 bg-gray-100 border-gray-300' },
  immature: { label: '还太早', cls: 'text-yellow-800 bg-yellow-50 border-yellow-200' },
  info: { label: '仅供参考', cls: 'text-blue-700 bg-blue-50 border-blue-200' },
}

/** 花费行单位是「分」，页面上统一换成元（账户币种）。 */
export function formatRowValue(row: Pick<ReconcileRow, 'unit'>, value: number | null): string {
  if (value === null) return '—'
  if (row.unit === '分') return (value / 100).toFixed(2)
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export interface ApproveButtonState {
  visible: boolean
  disabled: boolean
  label: string
  hint: string
  /** 没过关的项，一项一行：缺什么 + 怎么办 */
  blockers: { label: string; reason: string; how: string }[]
}

const HIDDEN: ApproveButtonState = { visible: false, disabled: true, label: '', hint: '', blockers: [] }

function short(r: GateResult) {
  const label = r.phase_name ? `${r.phase_name}：${r.label}` : r.label
  return { label, reason: r.reason, how: r.how }
}

export function approveButtonState(board: Pick<PromoBoard, 'plan_status' | 'approval' | 'spec_valid'>): ApproveButtonState {
  if (board.plan_status !== 'draft') return HIDDEN
  if (!board.spec_valid || !board.approval) {
    return { visible: true, disabled: true, label: '暂时不能批', hint: '推广计划的内容还有问题，先改好再批。', blockers: [] }
  }
  const a = board.approval
  if (!a.can_approve) {
    return { visible: true, disabled: true, label: '暂时不能批', hint: '下面这些项没过关，处理完才能批。', blockers: a.blockers.map(short) }
  }
  const n = a.unverified.length
  if (n > 0) {
    return {
      visible: true, disabled: false, label: `批准计划（${n} 项未核实）`,
      hint: '有项目还没核实。默认先别批，找负责人问清楚。批准后只会派出内部待办，广告不会自动投放。',
      blockers: a.unverified.map(short),
    }
  }
  return { visible: true, disabled: false, label: '批准计划', hint: '批准后只会派出内部待办，广告不会自动投放。', blockers: [] }
}

/**
 * 已批准计划上「按计划继续」是否该出现。
 * 到期阶段的检查清单没过关时，不能留下「看过、没意见」的记录。
 */
export function continueButtonVisible(board: Pick<PromoBoard, 'plan_status' | 'reconcile' | 'reviewed_this_window'> & Partial<Pick<PromoBoard, 'approval' | 'content_changed'>>): boolean {
  if (board.plan_status !== 'approved' || board.reconcile === null || board.reviewed_this_window) return false
  // 批准之后内容被改过：看的是旧版本，不能盖「没意见」
  if (board.content_changed) return false
  // 到期阶段的硬门没过关（红/灰）时，不能留下"看过、没意见"的记录
  if (board.approval && board.approval.blockers.length > 0) return false
  // 只有对账没异常才允许"没意见"：看不清 / 落后 / 超标时点它会留下误导的"看过、没意见"记录
  const rec = board.reconcile
  return !rec.blind && !rec.rows.some(r => r.status === 'behind' || r.status === 'over')
}
