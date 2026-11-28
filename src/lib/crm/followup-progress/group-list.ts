/**
 * The guests of one follow-up group, in the order staff should work them. Pure.
 *
 * The page "跟进进度" shows this when a group is opened, so "38 guests" is one click from the 38 names.
 * Same verdicts as the counts (`load.ts`), so the list is never longer or shorter than its number.
 */

import { contactCardTitle } from '@/lib/crm/display-name'
import { FOLLOWUP_GROUPS, type FollowupGroup } from './groups'
import type { FollowupProgressDetail } from './load'

/** How many guests one list shows. The page says so next to the full count when there are more. */
export const GROUP_LIST_MAX = 300

export interface GroupListRow {
  contactId: string
  name: string
  lastEnquiryAt: string | null
  lastGuestMessageAt: string | null
  lastStaffAt: string | null
}

export interface GroupList {
  group: FollowupGroup
  total: number
  rows: GroupListRow[]
}

/** The group named in the URL, or null when it is not one of the groups. */
export function parseGroup(v: string | string[] | undefined): FollowupGroup | null {
  const one = Array.isArray(v) ? v[0] : v
  return (FOLLOWUP_GROUPS as readonly string[]).includes(one ?? '') ? (one as FollowupGroup) : null
}

/** Groups where the guest is waiting on us: ordered by when the guest last spoke. The rest by the latest form. */
const BY_GUEST_MESSAGE: ReadonlySet<FollowupGroup> = new Set<FollowupGroup>(['awaiting_reply', 'unknown_sender'])

function ms(iso: string | null): number {
  if (iso === null) return 0
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : 0
}

export function memberIds(detail: FollowupProgressDetail, group: FollowupGroup): string[] {
  const ids: string[] = []
  for (const [id, v] of detail.verdicts) if (v.inScope && v.group === group) ids.push(id)
  return ids
}

/** Newest first (the guest who just reached out is the one most worth a call), ties broken by id so the order is stable. */
export function buildGroupList(detail: FollowupProgressDetail, group: FollowupGroup, names: ReadonlyMap<string, string | null>): GroupList {
  const key = BY_GUEST_MESSAGE.has(group) ? 'lastGuestMessageAt' : 'lastEnquiryAt'
  const rows: GroupListRow[] = memberIds(detail, group).map((id) => {
    const d = detail.dates.get(id)
    return { contactId: id, name: contactCardTitle(names.get(id)), lastEnquiryAt: d?.lastEnquiryAt ?? null, lastGuestMessageAt: d?.lastGuestMessageAt ?? null, lastStaffAt: d?.lastStaffAt ?? null }
  })
  rows.sort((a, b) => ms(b[key]) - ms(a[key]) || ms(b.lastStaffAt) - ms(a.lastStaffAt) || a.contactId.localeCompare(b.contactId))
  return { group, total: rows.length, rows: rows.slice(0, GROUP_LIST_MAX) }
}
