/**
 * 批准记录的大白话（纯函数）：页面上「谁、什么时候批的、批准时检查清单什么状态、派出了什么」。
 * 只读 generation_meta.approval_receipt；没有记录时明说「没有记录」，不替它编。
 * 记录来自数据库里的 JSON，可能残缺或被手改：每个字段先核对类型，核对不过就当「没有记录」，绝不让页面崩。
 */

import type { MarketingPlan } from '../types'
import { hasPromoField, readPromoSpec } from './spec'
import { promoContentHash } from './content-hash'
import { LIGHT_META } from './labels'
import type { Light } from './gates'

export type RecordTone = 'normal' | 'neutral' | 'alert'

export interface ApprovalRecordView {
  tone: RecordTone
  headline: string
  lines: string[]
}

const LIGHT_ORDER: Light[] = ['green', 'yellow', 'gray', 'red']
const TIME_ZONE = 'Australia/Sydney'

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const asCount = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** 悉尼时间，格式 2026-10-20 14:04（悉尼时间）；时间缺失或不是合法日期时写「没有记录」。 */
function whenOf(iso: unknown): string {
  const text = asString(iso)
  const date = text ? new Date(text) : null
  if (!date || Number.isNaN(date.getTime())) return '没有记录'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}（悉尼时间）`
}

function snapshotLine(snapshot: Record<string, unknown>): string | null {
  if (!Array.isArray(snapshot.results)) return null
  const lights = snapshot.results.map(r => (isRecord(r) && typeof r.light === 'string' ? r.light : null))
  const known = LIGHT_ORDER.map(l => ({ l, n: lights.filter(x => x === l).length })).filter(x => x.n > 0)
  const other = lights.length - known.reduce((sum, x) => sum + x.n, 0)
  const parts = [...known.map(x => `${x.n} 项${LIGHT_META[x.l].label}`), ...(other > 0 ? [`${other} 项格式无法识别`] : [])]
  return `批准时的检查清单：${parts.length > 0 ? parts.join('，') : '没有检查项'}（${whenOf(snapshot.taken_at)}）`
}

/** 预算那一道批准时用的是哪份证据（现读 / 存档 / 想现读没读成而用存档）；较早的批准没有这个字段，返回 null。 */
function budgetEvidenceLine(snapshot: Record<string, unknown>): string | null {
  if (!Array.isArray(snapshot.results)) return null
  const row = snapshot.results.find(r => isRecord(r) && r.key === 'env.account_billing' && typeof r.source === 'string')
  if (!isRecord(row)) return null
  const when = whenOf(row.as_of)
  switch (row.source) {
    case 'live': return `广告账户与付款（含在投预算）：批准时现读的（${when}）。`
    case 'receipt': return `广告账户与付款（含在投预算）：用的是每天早上自动检查的存档（${when}），不是批准时现读的。`
    case 'receipt_after_live_failed': return `广告账户与付款（含在投预算）：批准时想现读但没读成，用的是存档（${when}）。`
    default: return null
  }
}

function dispatchLine(receipt: Record<string, unknown>, hasSnapshot: boolean): string {
  const created = asCount(receipt.tasks_created)
  if (created === 0 && hasSnapshot) return '批准后还没有自动生成待办或每日计划（带推广结构的计划批准后暂不自动派活）。'
  const skipped = asCount(receipt.tasks_skipped)
  return `派出内部待办 ${created} 张${skipped > 0 ? `，跳过 ${skipped} 张已存在的` : ''}；生产包 ${asCount(receipt.packages_created)} 个。`
}

function noReceiptView(plan: Pick<MarketingPlan, 'status' | 'approved_at' | 'plan_data'>): ApprovalRecordView {
  const approvedAt = asString(plan.approved_at)
  // 带推广结构、或连批准时间都没有：批准一定该留下记录却没有 → 异常，标红
  if (hasPromoField(plan.plan_data) || !approvedAt) {
    return {
      tone: 'alert',
      headline: '这份计划是已批准状态，但系统里没有批准记录',
      lines: [
        '它可能不是从「批准计划」按钮批的，批准前的检查没有跑过。',
        '如果还要继续用，建议先退回草稿，再从页面重新批准。',
      ],
    }
  }
  // 较早的普通计划：当时还没有记录批准回执，不是异常
  return {
    tone: 'neutral',
    headline: '批准记录',
    lines: [`批准时间：${whenOf(approvedAt)}`, '这份计划批准时，系统还没有记录批准人（较早的计划）。'],
  }
}

/** 已批准 / 已完成的计划才有记录可看；草稿和已归档返回 null。 */
export function describeApprovalRecord(
  plan: Pick<MarketingPlan, 'status' | 'generation_meta' | 'approved_at' | 'plan_data'>,
): ApprovalRecordView | null {
  if (plan.status !== 'approved' && plan.status !== 'completed') return null
  const receipt: unknown = plan.generation_meta?.approval_receipt
  if (!isRecord(receipt) || asString(receipt.approved_at) === null) return noReceiptView(plan)

  const snapshot = isRecord(receipt.gate_snapshot) ? receipt.gate_snapshot : null
  const snapshotText = snapshot ? snapshotLine(snapshot) : null
  const budgetText = snapshot ? budgetEvidenceLine(snapshot) : null

  // 内容版本：批准时的内容指纹和现在的内容指纹对不上 → 批准后内容被改过，标红
  const approvedHash = asString(receipt.content_hash)
  const spec = readPromoSpec(plan.plan_data)
  let contentText: string | null = null
  let contentChanged = false
  if (spec !== null) {
    if (approvedHash === null) {
      contentText = '这份计划的批准没有记录内容版本（较早的计划）。'
    } else if (approvedHash === promoContentHash(spec)) {
      contentText = '批准的就是现在这一版内容。'
    } else {
      contentText = '⚠️ 批准的不是现在这一版内容：批准之后计划内容被改过。请退回草稿后重新批准。'
      contentChanged = true
    }
  }

  return {
    tone: contentChanged ? 'alert' : 'normal',
    headline: '批准记录',
    lines: [
      `批准人：${asString(receipt.approved_by) ?? '没有记录'}`,
      `批准时间：${whenOf(receipt.approved_at)}`,
      ...(snapshotText ? [snapshotText] : []),
      ...(budgetText ? [budgetText] : []),
      ...(contentText ? [contentText] : []),
      dispatchLine(receipt, snapshot !== null),
    ],
  }
}
