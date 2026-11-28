/**
 * The weekly follow-up report: what happened last week, how big each group is now and how it moved, and who to
 * ring first this week. Pure: builds the model, the subject and the HTML. The send is in `weekly-report-send.ts`,
 * the run in `inngest/functions/crm-followup-weekly-report`.
 *
 * The body is in English: the report is for the client's sales team (same choice as the daily enquiry digest).
 *
 * Privacy (same rule as the other digests, `digest-shared`): a guest is a name and a link into the CRM. No email
 * address, no phone number. Lists are capped, and the cap is said out loud next to the full count.
 */

import { contactUrl, digestName, esc, scrubContactDetails, APP_BASE } from '@/lib/crm/digest-shared'
import { DEFAULT_GROUP_CONFIG, FOLLOWUP_GROUPS, type FollowupGroup, type GroupCounts } from './groups'
import { delta, pointDaysAgo, type DayPoint } from './history'
import type { FollowupProgressDetail, WeekActivity } from './load'

/** How many guests each call list shows. */
export const LIST_MAX = 15

/** English wording per group, for the report only. The CRM page keeps its own (Chinese) wording in `groups.ts`. */
export const GROUP_LABEL_EN: Record<FollowupGroup, string> = {
  awaiting_reply: 'Guest wrote or rang, no reply on record',
  unknown_sender: 'Emailed out of the blue (no form, no contact on record)',
  new_lead: `New form in the last ${DEFAULT_GROUP_CONFIG.newLeadDays} days, no call or email on record yet`,
  never_contacted: 'Filled a form earlier, no call or email on record',
  no_enquiry: 'No form and no contact on record',
  qualified: 'High intent, not booked yet',
  warm: 'Called or emailed before, still opening our emails',
  cold: `Called or emailed before, quiet for ${DEFAULT_GROUP_CONFIG.warmDays} days`,
  later: 'Said "later", or snoozed by staff',
  ai: 'With the AI follow-up',
  no_contact_details: 'No email and no phone',
}

export interface ReportGuest {
  contactId: string
  name: string
  /** When the guest filled the form / wrote, ISO. */
  at: string | null
}

export interface WeeklyReport {
  clientId: string
  clientName: string
  /** "Mon 30 Nov" — the day the report is for, in the client's time zone. */
  day: string
  week: WeekActivity
  counts: GroupCounts
  /** Change per group since the snapshot a week ago; null = no snapshot that old yet. */
  changes: Record<FollowupGroup, number | null>
  newLeads: { total: number; shown: ReportGuest[] }
  awaitingReply: { total: number; shown: ReportGuest[] }
  /** Guests matching the AI pickup rules today; null = it could not be read, and the report then says nothing. */
  aiReady: number | null
}

function ms(iso: string | null): number {
  if (iso === null) return 0
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : 0
}

const NO_NAME = 'No name given'

/**
 * How the report names a guest. A name field can hold an address or a number ("Mary 021 555 1234"): both are cut
 * before it is printed, and what the shared helpers print in Chinese is put in English for this report.
 */
export function reportName(displayName: string | null | undefined): string {
  const cleaned = scrubContactDetails(digestName(displayName)).replace(/（号码略）/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned === '' || cleaned === '未留姓名' ? NO_NAME : cleaned
}

function members(detail: FollowupProgressDetail, group: FollowupGroup, by: 'lastEnquiryAt' | 'lastGuestMessageAt', names: ReadonlyMap<string, string | null>): { total: number; shown: ReportGuest[] } {
  const all: ReportGuest[] = []
  for (const [id, v] of detail.verdicts) {
    if (!v.inScope || v.group !== group) continue
    all.push({ contactId: id, name: reportName(names.get(id)), at: detail.dates.get(id)?.[by] ?? null })
  }
  // Newest first: the guest who just reached out is the one most worth a call today.
  all.sort((a, b) => ms(b.at) - ms(a.at) || a.contactId.localeCompare(b.contactId))
  return { total: all.length, shown: all.slice(0, LIST_MAX) }
}

/** Ids of the guests the report names, so the caller reads only those names. */
export function listedContactIds(detail: FollowupProgressDetail): string[] {
  const ids: string[] = []
  for (const [id, v] of detail.verdicts) if (v.inScope && (v.group === 'new_lead' || v.group === 'awaiting_reply')) ids.push(id)
  return ids
}

export function buildWeeklyReport(input: {
  clientName: string
  day: string
  detail: FollowupProgressDetail
  history: readonly DayPoint[]
  names: ReadonlyMap<string, string | null>
  aiReady: number | null
  now: Date
}): WeeklyReport {
  const { detail, history, now } = input
  const weekAgo = pointDaysAgo(history, now, 7)
  const changes = {} as Record<FollowupGroup, number | null>
  for (const g of FOLLOWUP_GROUPS) changes[g] = delta(detail.counts, weekAgo, g)
  return {
    clientId: detail.clientId,
    clientName: input.clientName,
    day: input.day,
    week: detail.week,
    counts: detail.counts,
    changes,
    newLeads: members(detail, 'new_lead', 'lastEnquiryAt', input.names),
    awaitingReply: members(detail, 'awaiting_reply', 'lastGuestMessageAt', input.names),
    aiReady: input.aiReady,
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function buildWeeklySubject(r: WeeklyReport): string {
  return `[Beta] ${r.clientName} · follow-up report ${r.day}: ${plural(r.newLeads.total, 'new lead', 'new leads')} to call, ${r.awaitingReply.total} waiting for a reply`
}

function changeText(n: number | null): string {
  if (n === null) return '<span style="color:#94a3b8">no record yet</span>'
  if (n === 0) return '<span style="color:#64748b">no change</span>'
  return n > 0 ? `up ${n}` : `down ${-n}`
}

function crmUrl(clientId: string, page: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/crm/${page}`
}

function dayOf(iso: string | null, timeZone: string): string {
  if (iso === null || !Number.isFinite(Date.parse(iso))) return ''
  return new Intl.DateTimeFormat('en-NZ', { timeZone, day: 'numeric', month: 'short' }).format(new Date(iso))
}

function renderList(title: string, hint: string, list: { total: number; shown: ReportGuest[] }, clientId: string, timeZone: string, verb: string): string {
  if (list.total === 0) return `<p style="font-size:15px;font-weight:600;margin:22px 0 2px">${esc(title)} (0)</p><p style="font-size:13px;color:#64748b;margin:0">Nobody in this group right now.</p>`
  const rows = list.shown.map((g) => {
    const when = dayOf(g.at, timeZone)
    return `<div style="padding:7px 0;border-bottom:1px solid #e2e8f0;font-size:14px"><b>${esc(g.name)}</b>${when ? ` <span style="color:#64748b">· ${esc(verb)} ${esc(when)}</span>` : ''} · <a href="${esc(contactUrl(clientId, g.contactId))}" style="color:#2563eb">open in CRM</a></div>`
  }).join('')
  const more = list.total > list.shown.length ? `<p style="font-size:13px;color:#64748b;margin:6px 0 0">Showing the ${list.shown.length} most recent of ${list.total}. The rest are in the CRM.</p>` : ''
  return `<p style="font-size:15px;font-weight:600;margin:22px 0 2px">${esc(title)} (${list.total})</p><p style="font-size:13px;color:#64748b;margin:0 0 4px">${esc(hint)}</p>${rows}${more}`
}

function renderWeek(w: WeekActivity): string {
  const cells: Array<[string, number]> = [
    ['New enquiries', w.newEnquiries],
    ['Guests with a staff call or email on record', w.guestsContactedByStaff],
    ['Guests who wrote or rang', w.guestsWhoReplied],
    ['Moved to high intent', w.movedToQualified],
    ['New bookings', w.newBookings],
    ['Handed to the AI follow-up', w.takenByAi],
  ]
  const tds = cells.map(([label, n]) => `<td style="padding:8px 10px;border:1px solid #e2e8f0;vertical-align:top;width:33%"><div style="font-size:12px;color:#64748b">${esc(label)}</div><div style="font-size:20px;font-weight:600">${n}</div></td>`)
  return `<table style="border-collapse:collapse;width:100%"><tr>${tds.slice(0, 3).join('')}</tr><tr>${tds.slice(3).join('')}</tr></table>`
}

function renderGroups(r: WeeklyReport): string {
  const rows = FOLLOWUP_GROUPS.map((g) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:14px">${esc(GROUP_LABEL_EN[g])}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:14px;text-align:right;font-weight:600">${r.counts.groups[g]}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px">${changeText(r.changes[g])}</td></tr>`).join('')
  return `<table style="border-collapse:collapse;width:100%"><tr><th style="text-align:left;padding:6px 8px;font-size:12px;color:#64748b;font-weight:400">Group</th><th style="text-align:right;padding:6px 8px;font-size:12px;color:#64748b;font-weight:400">Guests</th><th style="text-align:left;padding:6px 8px;font-size:12px;color:#64748b;font-weight:400">vs a week ago</th></tr>${rows}</table>`
}

function renderAi(r: WeeklyReport): string {
  if (r.aiReady === null) return ''
  const link = `<a href="${esc(crmUrl(r.clientId, 'ai-pickup'))}" style="color:#2563eb">Open the "交给 AI" page</a>`
  if (r.aiReady === 0) return `<p style="font-size:14px;margin:18px 0 0"><b>AI follow-up:</b> nobody matches the AI pickup rules today.</p>`
  return `<p style="font-size:14px;margin:18px 0 0"><b>AI follow-up:</b> ${plural(r.aiReady, 'guest matches', 'guests match')} the AI pickup rules (enquired 7 or more days ago with no call on record, or rung and not reached). They wait on the "交给 AI" page until a person releases them; the page offers a limited batch each day and holds back anyone it cannot email. ${link}. Handed over in the last 7 days: ${r.week.takenByAi}.</p>`
}

function renderUnknown(r: WeeklyReport): string {
  const n = r.counts.groups.unknown_sender
  if (n === 0) return ''
  return `<p style="font-size:14px;margin:18px 0 0"><b>Also:</b> ${plural(n, 'sender', 'senders')} emailed without ever filling a form, and there is no reply on record. Some are guests writing directly, others are suppliers or sales pitches. They are not listed here: they are in the CRM under "全部客人", and each one needs a person to open the record and decide.</p>`
}

/**
 * Shown at the top of every edition while the report is in Beta (PM 2026-11-28: "标记清楚这是 Beta 功能").
 * It says what Beta means for the reader: the numbers are only as complete as the CRM records, and who to tell.
 */
export const BETA_NOTICE = `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 12px;margin:0 0 16px;font-size:13px;color:#78350f"><b>Beta.</b> This weekly report is a new feature from Magic Engine and is still being tuned. The names and numbers come from what is recorded in the CRM, so a call from a personal phone or a reply sent outside the CRM can be missing: please check before acting on a name. If something looks wrong or is missing, tell Magic Engine at hello@magicengine.cloud.</div>`

export function buildWeeklyBody(r: WeeklyReport, timeZone: string): string {
  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a">
      ${BETA_NOTICE}
      <p style="font-size:17px;font-weight:600;margin:0 0 4px">${esc(r.clientName)} — weekly follow-up report, ${esc(r.day)}</p>
      <p style="font-size:14px;color:#334155;margin:0 0 14px">${r.counts.inScope} guests still being followed up. <a href="${esc(crmUrl(r.clientId, 'followup-progress'))}" style="color:#2563eb">See the live numbers</a>.</p>
      <p style="font-size:15px;font-weight:600;margin:0 0 6px">The last 7 days</p>
      ${renderWeek(r.week)}
      ${renderList('Call first: new leads', `Filled a form in the last ${DEFAULT_GROUP_CONFIG.newLeadDays} days, with no call or email on record since. Newest first. This list has its own rules and can differ from the "今天先联系" page; the guest's CRM record is the final word.`, r.newLeads, r.clientId, timeZone, 'form on')}
      ${renderList('Reply today: guests waiting for an answer', 'Wrote or rang, and there is no reply on record. Most recent first. Check the mailbox first: a reply sent from outside the CRM may not be recorded.', r.awaitingReply, r.clientId, timeZone, 'last heard')}
      ${renderUnknown(r)}
      ${renderAi(r)}
      <p style="font-size:15px;font-weight:600;margin:24px 0 6px">Every group today</p>
      ${renderGroups(r)}
      <p style="margin-top:20px;font-size:11px;color:#94a3b8">
        "Called or emailed" counts calls, emails and WhatsApp recorded in the system (a call nobody answered still counts as called). Calls made from a personal phone and Facebook Messenger chats are not counted.
        Contact details are left out on purpose — open the CRM link to see them.
        Sent automatically every Monday morning by Magic Engine (Beta).
      </p>
    </div>`
}
