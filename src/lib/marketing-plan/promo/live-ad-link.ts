/**
 * Read-only link from live ad sets to the current approved plan and to budget changes.
 * Built only from receipts already stored. Does not call Meta, write, or invent an approval.
 */
import { publicAdAccountName } from '@/lib/ads/spend-figures'
import {
  formatBudgetMinor,
  meLedgerExplainsChange,
  statusLabel,
  type FieldChange,
  type MeLedgerEntry,
} from './live-ad-snapshot-diff'

const SYDNEY = 'Australia/Sydney'
const CHANGE_CAP = 8

export type LaunchBasis = 'pm' | 'confirmation_card' | 'recorded'

export interface LaunchReceipt {
  actionId: string
  adSetIds: string[]
  campaignId: string
  /** Original authorization time. Never rewritten. */
  authorizedAt: string
  basis: LaunchBasis
}

export interface LinkPlan { id: string; title: string; approvedAt: string }
export interface LinkAdset { id: string; name: string | null; accountLabel: string | null; campaignId: string | null }
export interface BudgetChange {
  adSetId: string
  at: string
  fromAt: string
  beforeMinor: number
  afterMinor: number
}
export interface BudgetApproval {
  runId: string
  adSetId: string | null
  campaignId: string | null
  afterMinor: number
  approvedAt: string
}
export interface PlanRow { id: string; title: string; status: string; approvedAt: string | null; superseded: boolean }

export function parseLaunchReceipts(rows: readonly { id: string; payload: unknown }[]): LaunchReceipt[] {
  return rows.flatMap(row => {
    const parsed = parseOne(row)
    return parsed ? [parsed] : []
  })
}

export function pickCurrentApprovedPlan(rows: readonly PlanRow[]): LinkPlan | null {
  const open = rows.filter(row => row.status === 'approved' && !row.superseded && valid(row.approvedAt))
  open.sort((a, b) => Date.parse(b.approvedAt ?? '') - Date.parse(a.approvedAt ?? '') || (a.id < b.id ? -1 : 1))
  const top = open[0]
  if (!top?.approvedAt) return null
  const title = top.title.trim()
  return { id: top.id, title: title === '' ? '未命名计划' : title, approvedAt: top.approvedAt }
}

export function parseBudgetApproval(row: {
  id: string
  input: unknown
  finishedAt: string | null
  decisionAt: string | null
  readbackPassed: boolean
}): BudgetApproval | null {
  if (!row.readbackPassed) return null
  const input = rec(row.input)
  const afterMinor = readMinor(input?.after_cents)
  const approvedAt = valid(row.decisionAt) ?? valid(row.finishedAt)
  const id = row.id.trim()
  if (afterMinor === null || approvedAt === null || id === '') return null
  return { runId: id, adSetId: text(input?.adset_id), campaignId: text(input?.campaign_id), afterMinor, approvedAt }
}

export function readMinor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

export function budgetChangesFromSnapshots(rows: readonly {
  entityId: string
  capturedAt: string
  dailyBudgetMinor: number | null
}[]): BudgetChange[] {
  const grouped = new Map<string, { capturedAt: string; dailyBudgetMinor: number | null }[]>()
  for (const row of rows) grouped.set(row.entityId, [...(grouped.get(row.entityId) ?? []), row])
  return [...grouped].flatMap(([adSetId, list]) => changesFor(adSetId, list))
}

export function describeLiveAdLink(input: {
  plan: LinkPlan | null
  adsets: readonly LinkAdset[]
  receipts: readonly LaunchReceipt[]
  changes: readonly BudgetChange[]
  fieldChanges: readonly FieldChange[]
  approvals: readonly BudgetApproval[]
  meLedger: readonly MeLedgerEntry[]
  changesTruncated: boolean
}): string[] {
  if (input.adsets.length === 0) return ['现在没有开着的广告组，所以没有要挂到已批准计划上的在投广告。']
  const ordered = [...input.adsets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lines = [planLine(input.plan), ...ordered.map((adset, index) => launchLine(adset, index, input.plan, input.receipts))]
  lines.push(...fieldChangeLines(ordered, input.fieldChanges, input.approvals, input.meLedger))
  if (input.changesTruncated) lines.push('广告组的历史快照这次没有读全，更早的预算变动没有逐条列出。')
  return lines
}

function parseOne(row: { id: string; payload: unknown }): LaunchReceipt | null {
  const payload = rec(row.payload)
  const activation = rec(payload?.activation)
  const authorizedAt = str(activation?.authorized_at)
  const actionId = str(row.id)
  const adSetIds = payload ? adSetIdsOf(payload) : []
  if (!payload || payload.status !== 'active' || activation?.status !== 'executed') return null
  if (authorizedAt === '' || Number.isNaN(Date.parse(authorizedAt)) || !hasReadBack(payload)) return null
  if (adSetIds.length === 0 || actionId === '') return null
  return { actionId, adSetIds, campaignId: str(payload.campaignId), authorizedAt, basis: basisOf(activation.basis) }
}

function hasReadBack(payload: Record<string, unknown>): boolean {
  if (typeof payload.readback === 'string' && payload.readback.trim() !== '') return true
  // Go-live writes this only after the settle read-back says the ad is live.
  return typeof payload.goLiveStartedAt === 'string' && !Number.isNaN(Date.parse(payload.goLiveStartedAt))
}

function basisOf(value: unknown): LaunchBasis {
  if (value === 'go_live_card') return 'confirmation_card'
  if (value === 'global_admin') return 'pm'
  return 'recorded'
}

function adSetIdsOf(payload: Record<string, unknown>): string[] {
  const ids: string[] = []
  const single = str(payload.adSetId)
  if (single !== '') ids.push(single)
  if (!Array.isArray(payload.adSetIds)) return ids
  for (const item of payload.adSetIds) {
    const id = str(item)
    if (id !== '' && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function earliestReceipt(adSetId: string, receipts: readonly LaunchReceipt[]): LaunchReceipt | null {
  const hits = receipts.filter(receipt => receipt.adSetIds.includes(adSetId))
  if (hits.length === 0) return null
  return hits.reduce((best, receipt) => (Date.parse(receipt.authorizedAt) < Date.parse(best.authorizedAt) ? receipt : best))
}

function changesFor(adSetId: string, rows: { capturedAt: string; dailyBudgetMinor: number | null }[]): BudgetChange[] {
  const sorted = [...rows].sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1))
  const out: BudgetChange[] = []
  let previous: number | null = null
  let fromAt = ''
  for (const row of sorted) {
    if (row.dailyBudgetMinor === null) continue
    if (previous !== null && row.dailyBudgetMinor !== previous) {
      out.push({
        adSetId,
        at: row.capturedAt,
        fromAt: fromAt || row.capturedAt,
        beforeMinor: previous,
        afterMinor: row.dailyBudgetMinor,
      })
    }
    previous = row.dailyBudgetMinor
    fromAt = row.capturedAt
  }
  return out
}

function planLine(plan: LinkPlan | null): string {
  if (!plan) return '现在没有已批准的推广计划，所以这些在投广告组还挂不上去。'
  return `当前已批准的计划「${plan.title}」是在 ${whenOf(plan.approvedAt)} 批准的。下面只把已有回执对上去，不改这个时间，也不改广告和预算。`
}

function launchLine(adset: LinkAdset, index: number, plan: LinkPlan | null, receipts: readonly LaunchReceipt[]): string {
  const name = displayName(adset, index)
  const receipt = earliestReceipt(adset.id, receipts)
  if (!receipt) return `${name}：无批准记录，没有对上已批准计划。`
  const who = receipt.basis === 'pm' ? '由 PM 本人批的' : receipt.basis === 'confirmation_card' ? '由确认卡批的' : '回执上没有写明是谁批的'
  const hung = plan ? `对上当前已批准的计划「${plan.title}」。` : '现在没有已批准的推广计划，所以还对不上去。'
  return `${name}：${hung}开投已经批准并读回，批准时间是 ${whenOf(receipt.authorizedAt)}，${who}。`
}

function fieldChangeLines(
  adsets: readonly LinkAdset[],
  fieldChanges: readonly FieldChange[],
  approvals: readonly BudgetApproval[],
  meLedger: readonly MeLedgerEntry[],
): string[] {
  const indexById = new Map(adsets.map((adset, index) => [adset.id, index]))
  const lines: string[] = []
  let hidden = 0
  const ordered = [...fieldChanges].sort((a, b) => (a.at < b.at ? -1 : 1))
  for (const change of ordered) {
    const index = indexById.get(change.adSetId)
    if (index === undefined) continue
    const adset = adsets[index]!
    const line = change.kind === 'budget'
      ? budgetChangeLine(adset, index, change, approvals, meLedger)
      : statusChangeLine(adset, index, change, meLedger)
    if (line === null) continue
    if (lines.length >= CHANGE_CAP) hidden += 1
    else lines.push(line)
  }
  return hidden > 0 ? [...lines, `还有 ${hidden} 笔预算或状态变动没有逐条写在这里。`] : lines
}

function budgetChangeLine(
  adset: LinkAdset,
  index: number,
  change: Extract<FieldChange, { kind: 'budget' }>,
  approvals: readonly BudgetApproval[],
  meLedger: readonly MeLedgerEntry[],
): string | null {
  const asBudget: BudgetChange = {
    adSetId: change.adSetId,
    at: change.at,
    fromAt: change.fromAt,
    beforeMinor: change.beforeMinor,
    afterMinor: change.afterMinor,
  }
  const approval = coverFor(asBudget, adset, approvals)
  const name = displayName(adset, index)
  if (approval) {
    return `${name}：快照里看到预算变过（${whenOf(change.at)}），对上了改预算回执，批准时间是 ${whenOf(approval.approvedAt)}。`
  }
  if (meLedgerExplainsChange(change, meLedger, adset.campaignId)) {
    return `${name}：快照里看到预算变过（${whenOf(change.at)}），无批准记录。`
  }
  return externalBudgetLine(name, change)
}

function statusChangeLine(
  adset: LinkAdset,
  index: number,
  change: Extract<FieldChange, { kind: 'status' }>,
  meLedger: readonly MeLedgerEntry[],
): string | null {
  if (meLedgerExplainsChange(change, meLedger, adset.campaignId)) return null
  const name = displayName(adset, index)
  return `${name}：状态从「${statusLabel(change.beforeStatus)}」变到「${statusLabel(change.afterStatus)}」，时间介于 ${whenOf(change.fromAt)} 与 ${whenOf(change.at)} 之间看出来，不是在 ME 里改的。`
}

function externalBudgetLine(name: string, change: Extract<FieldChange, { kind: 'budget' }>): string {
  const from = formatBudgetMinor(change.beforeMinor)
  const to = formatBudgetMinor(change.afterMinor)
  return `${name}：日预算从 ${from} 改到 ${to}，时间介于 ${whenOf(change.fromAt)} 与 ${whenOf(change.at)} 之间看出来，不是在 ME 里改的。`
}

function coverFor(change: BudgetChange, adset: LinkAdset, approvals: readonly BudgetApproval[]): BudgetApproval | null {
  const hits = approvals.filter(item => item.afterMinor === change.afterMinor && sameTarget(item, change, adset))
  if (hits.length === 0) return null
  return hits.reduce((best, item) => (Date.parse(item.approvedAt) < Date.parse(best.approvedAt) ? item : best))
}

function sameTarget(item: BudgetApproval, change: BudgetChange, adset: LinkAdset): boolean {
  if (item.adSetId) return item.adSetId === change.adSetId
  return item.campaignId !== null && item.campaignId === adset.campaignId
}

function displayName(adset: LinkAdset, index: number): string {
  const clean = adset.name?.trim() ?? ''
  const safe = clean !== '' && !/\d{10,}/.test(clean) ? clean : `第 ${index + 1} 个开着的广告组`
  return `${safe}（${publicAdAccountName(adset.accountLabel)}）`
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function text(value: unknown): string | null {
  const trimmed = str(value)
  return trimmed === '' ? null : trimmed
}

function valid(value: string | null): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? value : null
}

function whenOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间读不出来'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYDNEY, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}（悉尼时间）`
}
