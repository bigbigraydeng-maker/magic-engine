/**
 * 「今天调什么」里的跟进积压。判谁该算没跟进，用 crm/lead-followup-due，这里只排成一句人话。
 * 只出条数和广告组名称，不出客人姓名。
 */

import type { ActionRow, FollowupGroup, FollowupInput } from './types'

export const BUDGET_HOLD_NOTE = '先补跟进，暂不建议加预算'
export const FOLLOWUP_RATE_FLOOR = 0.8
export const FOLLOWUP_ACTION_KEY = 'ad-lead-followup'

export type { FollowupGroup, FollowupInput }

export function budgetHoldFor(input: FollowupInput | undefined): boolean {
  if (!input || input.unreadable) return false
  if (input.inWindow + input.outsideWindow <= 0) return false
  return input.rateWithin24h != null && input.rateWithin24h < FOLLOWUP_RATE_FLOOR
}

export function groupFollowupByAdset(
  items: readonly { adsetId?: string | null }[],
  names: ReadonlyMap<string, string>,
): FollowupGroup[] {
  const named = new Map<string, number>()
  let unplaced = 0
  const unnamedIds = new Set<string>()
  let unnamedLeads = 0
  for (const item of items) {
    const id = item.adsetId?.trim() ?? ''
    if (!id) {
      unplaced++
      continue
    }
    const name = names.get(id)?.trim() ?? ''
    if (!name) {
      unnamedIds.add(id)
      unnamedLeads++
      continue
    }
    named.set(name, (named.get(name) ?? 0) + 1)
  }
  const groups: FollowupGroup[] = [...named.entries()].map(([label, count]) => ({ label, count }))
  if (unnamedLeads > 0) {
    const label = unnamedIds.size > 1 ? `名称读不到（${unnamedIds.size} 个广告组）` : '名称读不到'
    groups.push({ label, count: unnamedLeads })
  }
  if (unplaced > 0) groups.push({ label: '没归到广告组', count: unplaced })
  return groups.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1))
}

function followupHow(groups: readonly FollowupGroup[]): string {
  if (groups.length === 0) return '打开客人名单逐条核对。'
  const shown = groups.slice(0, 6).map((g) => `${g.label} ${g.count} 条`)
  const rest = groups.length - shown.length
  const more = rest > 0 ? `，另有 ${rest} 个广告组` : ''
  return `${shown.join('，')}${more}。打开客人名单逐条联系。`
}

export function buildFollowupAction(input: FollowupInput): ActionRow {
  if (input.unreadable) {
    return {
      key: FOLLOWUP_ACTION_KEY,
      severity: 'yellow',
      what: '读不到广告线索有没有人跟进',
      how: '稍后重试；持续读不出来找开发',
      owner: 'dev',
    }
  }
  const waiting = input.inWindow + input.outsideWindow
  if (waiting <= 0) {
    return {
      key: FOLLOWUP_ACTION_KEY,
      severity: 'info',
      what: '超过 24 小时的广告线索都有人跟进了',
      how: '',
      owner: 'pm',
    }
  }
  const older = input.outsideWindow > 0 ? `，另有更早的 ${input.outsideWindow} 条` : ''
  return {
    key: FOLLOWUP_ACTION_KEY,
    severity: 'yellow',
    what: `广告线索超过 24 小时没人跟进：${input.inWindow} 条${older}`,
    how: followupHow(input.groups),
    owner: 'pm',
  }
}

export function withBudgetHold(text: string, hold: boolean): string {
  if (!hold || text.includes(BUDGET_HOLD_NOTE)) return text
  return `${text} ${BUDGET_HOLD_NOTE}`
}
