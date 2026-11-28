/**
 * The "跟进信" page's list: guests in the "still opening our emails" group who are due one personal follow-up letter
 * today. Read-only. The page drafts each letter with the existing AI follow-up writer and a person releases it
 * through the existing compose route, where every send check still runs.
 *
 * ## Who does what (PM 2026-11-28: "确保 AI 和 human 可以分工合作好")
 *
 *   staff keep   — anyone a person called or wrote to in the last `staffQuietDays` days: the AI does not step into a
 *                  conversation a person is having. Also every guest outside this group: high intent, waiting for a
 *                  reply, new leads, snoozed — those are staff's by the grouping itself (`groups.ts`).
 *   the AI drafts — a guest we contacted before, quiet since, who still opens our mail. One letter, then it waits.
 *   a person releases — every letter is read, edited if needed and ticked by a person. Nothing is sent unticked.
 *   back to staff — the moment the guest answers, the grouping moves them to "waiting for a reply": staff's list.
 *                  The AI never writes a second letter on top of a reply.
 *
 * Limits, all counted before a draft is paid for:
 *   one letter per guest per `onePerDays` days from the CRM mailbox, whoever sent it;
 *   no letter to a guest who already got `weeklyMax` mails in 7 days, bulk mails included (the client's rule);
 *   at most `dailyMax` letters a day from this page: a guest written today keeps their slot until tomorrow.
 *
 * Every read throws on error: this list decides who is written to, so a half read is no list at all.
 */

import type { ComposePreview } from '@/lib/microsoft/mail-send-new'
import { uuidFromSeed } from '@/lib/crm/ai-takeover/day7-list'
import { contactCardTitle } from '@/lib/crm/display-name'
import type { FollowupProgressDetail } from './load'

export interface LetterRules {
  staffQuietDays: number
  onePerDays: number
  weeklyMax: number
  dailyMax: number
}

export const DEFAULT_LETTER_RULES: LetterRules = { staffQuietDays: 14, onePerDays: 30, weeklyMax: 2, dailyMax: 10 }

export type LetterStatus = 'due' | 'staff_active' | 'already_written' | 'weekly_limit'

const DAY_MS = 86_400_000

function ms(iso: string | null): number | null {
  if (iso === null) return null
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : null
}

/** One guest of the group: due a letter, or why not. Pure. A date that cannot be read counts as "just now" (stay away). */
export function letterStatus(
  i: { lastStaffAt: string | null; lastCrmSendAt: string | null; bulkLast7Days: number },
  now: Date,
  rules: LetterRules = DEFAULT_LETTER_RULES,
): LetterStatus {
  const staff = i.lastStaffAt === null ? null : (ms(i.lastStaffAt) ?? now.getTime())
  if (staff !== null && now.getTime() - staff < rules.staffQuietDays * DAY_MS) return 'staff_active'
  const sent = i.lastCrmSendAt === null ? null : (ms(i.lastCrmSendAt) ?? now.getTime())
  if (sent !== null && now.getTime() - sent < rules.onePerDays * DAY_MS) return 'already_written'
  if (i.bulkLast7Days >= rules.weeklyMax) return 'weekly_limit'
  return 'due'
}

/** One request id per guest per round: the round ends when a person next contacts the guest. A second click is refused by the send route. */
export function letterRequestId(contactId: string, lastStaffAt: string | null): string {
  return uuidFromSeed(`followup-letter:${contactId}:${lastStaffAt === null ? 'never' : Date.parse(lastStaffAt)}`)
}

export interface LetterRow {
  contactId: string
  name: string
  lastEngagedAt: string | null
  lastStaffAt: string | null
  status: 'ready' | 'cannot_send'
  recipient: string | null
  /** Mails this guest got in the last 7 days: from the CRM mailbox plus bulk and machine mails. */
  sentLast7Days: number | null
  message: string | null
  requestId: string
}

export interface LetterList {
  rows: LetterRow[]
  counts: Record<LetterStatus, number> & { sentToday: number; room: number }
  rules: LetterRules
}

export interface LetterListDeps {
  timeZone: string
  loadProgress(): Promise<FollowupProgressDetail>
  /** contactId → latest send of ours in the CRM send log (pending or sent) for these guests. Throws on a read error. */
  loadLastSends(contactIds: readonly string[]): Promise<Map<string, string>>
  loadNames(ids: string[]): Promise<Map<string, string | null>>
  compose(contactId: string): Promise<ComposePreview>
}

function localDay(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(at))
}

interface Candidate { contactId: string; lastEngagedAt: string | null; lastStaffAt: string | null; bulkLast7Days: number }

function candidates(detail: FollowupProgressDetail): Candidate[] {
  const out: Candidate[] = []
  for (const [id, v] of detail.verdicts) {
    if (!v.inScope || v.group !== 'warm') continue
    const d = detail.dates.get(id)
    out.push({ contactId: id, lastEngagedAt: d?.lastEngagedAt ?? null, lastStaffAt: d?.lastStaffAt ?? null, bulkLast7Days: d?.bulkLast7Days ?? 0 })
  }
  // Most recently opened or clicked first: the guest reading us this week is the one a letter can reach.
  return out.sort((a, b) => (ms(b.lastEngagedAt) ?? 0) - (ms(a.lastEngagedAt) ?? 0) || a.contactId.localeCompare(b.contactId))
}

const PARALLEL_CHECKS = 5

async function checkMail(rows: LetterRow[], bulk: ReadonlyMap<string, number>, deps: LetterListDeps, rules: LetterRules): Promise<void> {
  for (let i = 0; i < rows.length; i += PARALLEL_CHECKS) {
    const batch = rows.slice(i, i + PARALLEL_CHECKS)
    const results = await Promise.all(batch.map((r) => deps.compose(r.contactId)))
    batch.forEach((r, k) => {
      const c = results[k]
      if (!c.canCompose) return void Object.assign(r, { status: 'cannot_send', message: c.message })
      const total = c.sentToContactLast7Days + (bulk.get(r.contactId) ?? 0)
      if (total >= rules.weeklyMax) return void Object.assign(r, { status: 'cannot_send', sentLast7Days: total, message: `近 7 天已经收到 ${total} 封（含群发），这周不再发` })
      Object.assign(r, { status: 'ready', recipient: c.recipient, sentLast7Days: total, message: null })
    })
  }
}

/** Today's letters: at most the day's room, each with its mail check and fixed request id. */
export async function loadLetterList(deps: LetterListDeps, now: Date = new Date(), rules: LetterRules = DEFAULT_LETTER_RULES): Promise<LetterList> {
  const detail = await deps.loadProgress()
  const pool = candidates(detail)
  const sends = await deps.loadLastSends(pool.map((c) => c.contactId))
  const today = localDay(now.getTime(), deps.timeZone)
  const counts = { due: 0, staff_active: 0, already_written: 0, weekly_limit: 0, sentToday: 0, room: 0 }
  const due: Candidate[] = []
  for (const c of pool) {
    const lastCrmSendAt = sends.get(c.contactId) ?? null
    const sentMs = ms(lastCrmSendAt)
    if (sentMs !== null && localDay(sentMs, deps.timeZone) === today) counts.sentToday += 1
    const status = letterStatus({ lastStaffAt: c.lastStaffAt, lastCrmSendAt, bulkLast7Days: c.bulkLast7Days }, now, rules)
    counts[status] += 1
    if (status === 'due') due.push(c)
  }
  counts.room = Math.max(0, rules.dailyMax - counts.sentToday)
  const picked = due.slice(0, counts.room)
  const names = await deps.loadNames(picked.map((c) => c.contactId))
  const rows: LetterRow[] = picked.map((c) => ({
    contactId: c.contactId, name: contactCardTitle(names.get(c.contactId)), lastEngagedAt: c.lastEngagedAt, lastStaffAt: c.lastStaffAt,
    status: 'cannot_send', recipient: null, sentLast7Days: null, message: null, requestId: letterRequestId(c.contactId, c.lastStaffAt),
  }))
  await checkMail(rows, new Map(pool.map((c) => [c.contactId, c.bulkLast7Days])), deps, rules)
  return { rows, counts, rules }
}

/** The same loader the day-7 list uses for "did we already write from the CRM mailbox". Re-exported so the route has one import. */
export { loadLastSendsFromLog } from '@/lib/crm/ai-takeover/day7-list'
