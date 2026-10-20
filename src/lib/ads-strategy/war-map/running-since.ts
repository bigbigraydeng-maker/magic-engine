/**
 * 「实际已经在跑的最早日子」——纯函数，不碰库。
 *
 * 🔴 「在跑」＝广告组最新一行是 ACTIVE，且它所属系列最新一行也是 ACTIVE。
 *    账户欠款时广告组仍可能是 ACTIVE，所以这里只回答「设置上开着」，不回答「真在投」。
 * 🔴 最新一行是 disappeared 的实体已经没了，不算在跑。
 */

import { nzDay } from './util'

export interface SnapRowLite {
  entityId: string
  campaignId: string | null
  effectiveStatus: string | null
  captureReason: string | null
  capturedAt: string // ISO
}

const DISAPPEARED = 'disappeared'
const ACTIVE = 'ACTIVE'

function byCapturedDesc(a: SnapRowLite, b: SnapRowLite): number {
  return Date.parse(b.capturedAt) - Date.parse(a.capturedAt)
}

/** 每个实体只留最新一行（输入乱序也行） */
function latestPerEntity(rows: SnapRowLite[]): Map<string, SnapRowLite> {
  const out = new Map<string, SnapRowLite>()
  for (const r of [...rows].sort(byCapturedDesc)) {
    if (!out.has(r.entityId)) out.set(r.entityId, r)
  }
  return out
}

function isRunning(row: SnapRowLite | undefined): boolean {
  return row !== undefined && row.captureReason !== DISAPPEARED && row.effectiveStatus === ACTIVE
}

/**
 * 这个广告组「这一段连续开着」的起点：从最新一行往回走，一直是 ACTIVE 就继续，碰到非 ACTIVE（暂停等）或 disappeared 就停。
 * 🔴 不能取「最近一次 changed 且 ACTIVE」：那是最后一次改设置的时间（调预算也算），不是开投日。
 * 窗口内一直开着就退回窗口内最早一行。
 */
function startOf(rows: SnapRowLite[]): string | null {
  let start: string | null = null
  for (const r of [...rows].sort(byCapturedDesc)) {
    if (r.captureReason === DISAPPEARED || r.effectiveStatus !== ACTIVE) break
    start = r.capturedAt
  }
  return start
}

/**
 * 实际已经在跑的最早日子（新西兰日期）。
 * 「在跑」＝广告组最新一行是 ACTIVE，且它所属系列最新一行也是 ACTIVE。
 * 起算时间＝这个广告组「连续开着」那一段的第一行（见 startOf）。返回所有在跑广告组里最早的那个新西兰日；没有在跑的 = null。
 */
export function computeRunningSince(adsetRows: SnapRowLite[], campaignRows: SnapRowLite[]): string | null {
  const campaigns = latestPerEntity(campaignRows)
  const adsets = latestPerEntity(adsetRows)
  const byAdset = new Map<string, SnapRowLite[]>()
  for (const r of adsetRows) {
    const list = byAdset.get(r.entityId) ?? []
    list.push(r)
    byAdset.set(r.entityId, list)
  }
  let earliest: string | null = null
  for (const [id, latest] of adsets) {
    if (!isRunning(latest)) continue
    if (latest.campaignId === null || !isRunning(campaigns.get(latest.campaignId))) continue
    const start = startOf(byAdset.get(id) ?? [])
    if (start === null) continue
    const day = nzDay(start)
    if (earliest === null || day < earliest) earliest = day
  }
  return earliest
}
