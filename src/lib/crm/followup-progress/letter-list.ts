/**
 * The "跟进信" page's list: guests in the "still opening our emails" group who are due one personal follow-up letter
 * today, and the re-check of one guest at the moment a letter is released. Read-only. The page drafts each letter
 * with the existing AI follow-up writer; a person releases it; the send goes through the existing send path, where
 * every send check still runs.
 *
 * ## Who does what (PM 2026-11-28: "确保 AI 和 human 可以分工合作好")
 *
 * The staff's own list decides first. Every guest is put through the same judgement as "今天先联系" (`segmentContact`):
 * a guest that list gives to staff today — replied, a callback due, a new lead, clicked a link, reading the site —
 * is staff's, and so is a guest it has parked or excluded (says "later", said no, bad number). The AI may draft only
 * for the quiet ones: a conversation that went silent, and guests that list has handed to "the system keeps in touch".
 * (On the quiet conversations the staff list still says "pick the longest-waiting and write a line": staff may do
 * that too. Whoever moves first wins — a staff contact takes the guest off this page, a released letter greys the
 * guest on theirs.)
 *
 * On top of that, the AI stays out when:
 *   a callback is set (in the future, or in the last `quietDays` days: the staff member is on it);
 *   the guest said no, or "not now", and has not come back since;
 *   anything human happened in the last `quietDays` days, on either side and on any channel — a call even if nobody
 *   answered, a personal mail, a WhatsApp or Messenger message, a staff note;
 *   the sales mailbox wrote to the guest in the last `onePerDays` days, whoever wrote;
 *   `maxUnanswered` letters have gone out since the guest last wrote, rang or filled a form, with no answer;
 *   the guest already got `weeklyMax` mails in 7 days, bulk mails included (the client's own cap).
 * And at most `dailyMax` letters a day leave the sales mailbox from "write it yourself" letters.
 *
 * A person releases — every letter is read, checked and ticked by a person. Nothing is sent unticked.
 * Back to staff — the moment the guest answers, the grouping moves them to "waiting for a reply": staff's list.
 *
 * The list is only a snapshot. `checkLetterRelease` runs the whole judgement again for the one guest at the moment
 * of release, so a call made an hour after the page was opened stops the letter. What it cannot see: a mail written
 * in the mailbox itself that has not been synced in yet, and a second send started in the same few seconds (the send
 * path's own lock and weekly cap are the backstop there; the daily cap can be passed by one in that window).
 *
 * Every read throws on error: this list decides who is written to, so a half read is no list at all.
 */

import type { ComposePreview } from '@/lib/microsoft/mail-send-new'
import { buildContactModel, type ContactRowLike, type StageMetaLike, type TouchpointRowLike } from '@/lib/crm/contact-model'
import { localDayStartMs } from '@/lib/crm/day-list'
import { contactCardTitle } from '@/lib/crm/display-name'
import { segmentContact, type Segment, type SiteReading, type TouchpointLike } from '@/lib/crm/segments'
import { uuidFromSeed } from '@/lib/crm/stable-uuid'
import type { FollowupProgressDetail } from './load'

export interface LetterRules {
  quietDays: number
  onePerDays: number
  maxUnanswered: number
  weeklyMax: number
  dailyMax: number
}

export const DEFAULT_LETTER_RULES: LetterRules = { quietDays: 14, onePerDays: 30, maxUnanswered: 2, weeklyMax: 2, dailyMax: 10 }

export type LetterStatus =
  | 'due'
  | 'staff_today'      // the staff's own list gives this guest to staff today
  | 'parked'           // that list has parked or excluded the guest
  | 'callback_set'
  | 'declined'
  | 'recent_activity'
  | 'already_written'
  | 'no_reply_stop'
  | 'weekly_limit'

/**
 * Segments of the staff's list where nobody is expected to ring today: a conversation that went quiet, and a guest
 * the list has handed to "the system keeps in touch". The only ones the AI may draft for. "Rang once, no answer"
 * is not here: that list asks staff to ring again.
 */
const AI_MAY_WRITE: ReadonlySet<Segment> = new Set<Segment>(['stale_conversation', 'handoff_sop'])
/** Segments that list has set aside: nobody acts now, the AI included. */
const PARKED: ReadonlySet<Segment> = new Set<Segment>(['nurture_future', 'excluded', 'not_enquiry_suspect'])
const NEGATIVE_OUTCOMES: ReadonlySet<string> = new Set(['not_interested', 'not_interested_now'])

const DAY_MS = 86_400_000

function ms(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : null
}

export interface LetterFacts {
  segment: Segment
  /** Latest thing a person did or the guest did, on any channel (machine sends and mail opens are not it). */
  lastActivityAt: string | null
  /** The callback time on the latest record that set one. */
  callbackAt: string | null
  /** The guest said no or "not now" and has not come back since. */
  declined: boolean
  /** Every send to this guest from the sales mailbox on record (pending or sent). */
  sendTimes: readonly string[]
  /** Last time the guest wrote, rang or filled a form. */
  lastGuestSignalAt: string | null
  /** Bulk mails in the last 7 days that the mailbox's own count cannot see. */
  bulkLast7Days: number
}

/** One guest of the group: due a letter, or why not. Pure. A date that cannot be read counts as "just now" (stay away). */
export function letterStatus(f: LetterFacts, now: Date, rules: LetterRules = DEFAULT_LETTER_RULES): LetterStatus {
  const t = now.getTime()
  const at = (iso: string | null): number | null => (iso === null ? null : (ms(iso) ?? t))
  if (PARKED.has(f.segment)) return 'parked'
  if (!AI_MAY_WRITE.has(f.segment)) return 'staff_today'
  if (f.declined) return 'declined'
  const callback = at(f.callbackAt)
  if (callback !== null && (callback > t || t - callback < rules.quietDays * DAY_MS)) return 'callback_set'
  const activity = at(f.lastActivityAt)
  if (activity !== null && t - activity < rules.quietDays * DAY_MS) return 'recent_activity'
  const sends = f.sendTimes.map((s) => ms(s) ?? t)
  if (sends.some((s) => t - s < rules.onePerDays * DAY_MS)) return 'already_written'
  const signal = at(f.lastGuestSignalAt) ?? 0
  if (sends.filter((s) => s > signal).length >= rules.maxUnanswered) return 'no_reply_stop'
  if (f.bulkLast7Days >= rules.weeklyMax) return 'weekly_limit'
  return 'due'
}

function isHumanSide(t: TouchpointLike): boolean {
  return !t.automated && !t.engagement && !t.action
}

/** The dated facts the rules read, from the same touch model the staff's list is built on. Exported for tests. */
export function activityFacts(touches: readonly TouchpointLike[]): Pick<LetterFacts, 'lastActivityAt' | 'callbackAt' | 'declined'> {
  let lastActivity: string | null = null
  let callback: { at: string; set: number } | null = null
  let negative = 0
  let lastGuest = 0
  for (const tp of touches) {
    const when = ms(tp.occurredAt) ?? 0
    if (isHumanSide(tp) && (lastActivity === null || when > (ms(lastActivity) ?? 0))) lastActivity = tp.occurredAt
    if (tp.callbackAt && (callback === null || when > callback.set)) callback = { at: tp.callbackAt, set: when }
    if ((tp.outcome && NEGATIVE_OUTCOMES.has(tp.outcome)) || tp.callStance) negative = Math.max(negative, when)
    if (tp.direction === 'inbound' && isHumanSide(tp)) lastGuest = Math.max(lastGuest, when)
  }
  return { lastActivityAt: lastActivity, callbackAt: callback?.at ?? null, declined: negative > 0 && lastGuest <= negative }
}

/**
 * One request id per guest per round. The round is "nothing human has happened since": any new call, message or
 * note changes the id, so a letter drafted before it cannot be released after it.
 */
export function letterRequestId(contactId: string, lastActivityAt: string | null): string {
  return uuidFromSeed(`followup-letter:${contactId}:${lastActivityAt === null ? 'never' : (ms(lastActivityAt) ?? lastActivityAt)}`)
}

export interface GuestRows {
  contacts: ContactRowLike[]
  touches: TouchpointRowLike[]
  stageMeta: Map<string, StageMetaLike>
  siteReading: ReadonlyMap<string, SiteReading>
}

export interface LetterListDeps {
  timeZone: string
  /** The client's own "at most N mails per guest per 7 days"; null = not set, the default applies. */
  weeklyMax: number | null
  /** The whole book, or one guest when an id is given. */
  loadProgress(only: string | null): Promise<FollowupProgressDetail>
  /** Contact rows, every touch (with the note text), the stage list and who is reading the site, for these guests. */
  loadGuestRows(ids: readonly string[]): Promise<GuestRows>
  /** contactId → every send of ours in the CRM send log (pending or sent). Throws on a read error. */
  loadSendTimes(ids: readonly string[]): Promise<Map<string, string[]>>
  /** How many "write it yourself" letters left the sales mailbox since this moment (today, client time). */
  countSentSince(sinceIso: string): Promise<number>
  loadNames(ids: string[]): Promise<Map<string, string | null>>
  compose(contactId: string): Promise<ComposePreview>
}

interface Evaluated {
  contactId: string
  status: LetterStatus
  lastEngagedAt: string | null
  lastActivityAt: string | null
  bulkLast7Days: number
  requestId: string
}

function startOfLocalDay(now: Date, timeZone: string): string {
  return new Date(localDayStartMs(now, timeZone)).toISOString()
}

function rulesFor(deps: LetterListDeps, rules: LetterRules): LetterRules {
  return deps.weeklyMax !== null && Number.isFinite(deps.weeklyMax) && deps.weeklyMax > 0 ? { ...rules, weeklyMax: deps.weeklyMax } : rules
}

/** The judgement for every guest of the group (or for one guest). */
async function evaluate(deps: LetterListDeps, now: Date, rules: LetterRules, only: string | null): Promise<Evaluated[]> {
  const detail = await deps.loadProgress(only)
  const ids: string[] = []
  for (const [id, v] of detail.verdicts) if (v.inScope && v.group === 'warm' && (only === null || id === only)) ids.push(id)
  if (ids.length === 0) return []
  const [rows, sends] = await Promise.all([deps.loadGuestRows(ids), deps.loadSendTimes(ids)])
  const rowOf = new Map(rows.contacts.map((c) => [c.id, c]))
  const touchesOf = new Map<string, TouchpointRowLike[]>()
  for (const t of rows.touches) touchesOf.set(t.contact_id, [...(touchesOf.get(t.contact_id) ?? []), t])
  const out: Evaluated[] = []
  for (const id of ids) {
    const row = rowOf.get(id)
    // A guest counted in the group but missing from the row read cannot be judged: left out, never guessed in.
    if (!row) continue
    const model = { ...buildContactModel(row, touchesOf.get(id) ?? [], rows.stageMeta), siteReading: rows.siteReading.get(id) ?? null }
    const d = detail.dates.get(id)
    const act = activityFacts(model.touchpoints)
    const signal = Math.max(ms(d?.lastGuestMessageAt) ?? 0, ms(d?.lastEnquiryAt) ?? 0)
    const status = letterStatus({
      segment: segmentContact(model, now).segment, ...act,
      sendTimes: sends.get(id) ?? [],
      lastGuestSignalAt: signal > 0 ? new Date(signal).toISOString() : null,
      bulkLast7Days: d?.bulkLast7Days ?? 0,
    }, now, rules)
    out.push({ contactId: id, status, lastEngagedAt: d?.lastEngagedAt ?? null, lastActivityAt: act.lastActivityAt, bulkLast7Days: d?.bulkLast7Days ?? 0, requestId: letterRequestId(id, act.lastActivityAt) })
  }
  return out
}

export interface LetterRow {
  contactId: string
  name: string
  lastEngagedAt: string | null
  lastActivityAt: string | null
  status: 'ready' | 'cannot_send'
  recipient: string | null
  /** Mails this guest got in the last 7 days: every mail of ours on record plus bulk mails without a send row. */
  sentLast7Days: number | null
  message: string | null
  requestId: string
}

export interface LetterList {
  rows: LetterRow[]
  counts: Record<LetterStatus, number> & { sentToday: number; room: number }
  rules: LetterRules
}

function emptyCounts(): LetterList['counts'] {
  return { due: 0, staff_today: 0, parked: 0, callback_set: 0, declined: 0, recent_activity: 0, already_written: 0, no_reply_stop: 0, weekly_limit: 0, sentToday: 0, room: 0 }
}

/** The mail check for one guest, with the weekly count that adds bulk mails the mailbox cannot see. */
async function mailCheck(deps: LetterListDeps, contactId: string, bulk: number, rules: LetterRules): Promise<{ ok: true; recipient: string; total: number } | { ok: false; total: number | null; message: string }> {
  const c = await deps.compose(contactId)
  if (!c.canCompose) return { ok: false, total: null, message: c.message }
  const total = c.sentToContactLast7Days + bulk
  if (total >= rules.weeklyMax) return { ok: false, total, message: `近 7 天已经收到 ${total} 封（含群发），这周不再发` }
  return { ok: true, recipient: c.recipient, total }
}

const PARALLEL_CHECKS = 5

/** Today's letters: at most the day's room, most recently engaged first, each with its mail check and request id. */
export async function loadLetterList(deps: LetterListDeps, now: Date = new Date(), baseRules: LetterRules = DEFAULT_LETTER_RULES): Promise<LetterList> {
  const rules = rulesFor(deps, baseRules)
  const [evaluated, sentToday] = await Promise.all([evaluate(deps, now, rules, null), deps.countSentSince(startOfLocalDay(now, deps.timeZone))])
  const counts = emptyCounts()
  for (const e of evaluated) counts[e.status] += 1
  counts.sentToday = sentToday
  counts.room = Math.max(0, rules.dailyMax - sentToday)
  const picked = evaluated.filter((e) => e.status === 'due')
    .sort((a, b) => (ms(b.lastEngagedAt) ?? 0) - (ms(a.lastEngagedAt) ?? 0) || a.contactId.localeCompare(b.contactId))
    .slice(0, counts.room)
  const names = await deps.loadNames(picked.map((e) => e.contactId))
  const rows: LetterRow[] = []
  for (let i = 0; i < picked.length; i += PARALLEL_CHECKS) {
    const batch = picked.slice(i, i + PARALLEL_CHECKS)
    const checks = await Promise.all(batch.map((e) => mailCheck(deps, e.contactId, e.bulkLast7Days, rules)))
    batch.forEach((e, k) => {
      const c = checks[k]
      rows.push({
        contactId: e.contactId, name: contactCardTitle(names.get(e.contactId)), lastEngagedAt: e.lastEngagedAt, lastActivityAt: e.lastActivityAt,
        status: c.ok ? 'ready' : 'cannot_send', recipient: c.ok ? c.recipient : null, sentLast7Days: c.total, message: c.ok ? null : c.message, requestId: e.requestId,
      })
    })
  }
  return { rows, counts, rules }
}

/** Why a letter that was on the list may no longer go, in the words shown to the person releasing it. */
export const RELEASE_REFUSAL: Record<Exclude<LetterStatus, 'due'> | 'not_in_group' | 'changed' | 'daily_cap', string> = {
  not_in_group: '这位客人现在不在这一组了：可能刚回了话、订了团、被员工接走，或不再打开邮件。这封没有发，回名单刷新一下。',
  staff_today: '员工的「今天先联系」名单上现在有他（刚回话、约的回电到了、点了链接…），这封没有发，请员工直接联系。',
  parked: '这位客人现在被放着或排除了（说了以后再说、不感兴趣、号码有问题…），这封没有发。',
  callback_set: '有员工给他约了回电，这封没有发，免得和员工撞上。',
  declined: '他说过暂时不考虑或不感兴趣，之后没有再来过，这封没有发。',
  recent_activity: '名单打开之后有人联系过他，或他自己来过消息，这封没有发。',
  already_written: '销售邮箱最近已经给他发过信了，这封没有发。',
  no_reply_stop: '已经给他写过几封没有回音，系统不再写，这封没有发。',
  weekly_limit: '他这周已经收到太多邮件（含群发），这封没有发。',
  changed: '名单打开之后他这边有了新动静（有人联系过他，或他自己来过消息），这封没有发。回名单刷新一下再看。',
  daily_cap: '今天销售邮箱的发信数已经到了这一页每天的上限，这封没有发，明天再放行。',
}

export type ReleaseCheck = { ok: true } | { ok: false; reason: keyof typeof RELEASE_REFUSAL | 'mail_check'; message: string }

/**
 * The whole judgement again, for one guest, at the moment a letter is released. The list was a snapshot; this is now.
 * `requestId` is the one the page got with the list: it changes when anything human happens, so a stale page cannot
 * release over a staff member's call.
 */
export async function checkLetterRelease(deps: LetterListDeps, input: { contactId: string; requestId: string }, now: Date = new Date(), baseRules: LetterRules = DEFAULT_LETTER_RULES): Promise<ReleaseCheck> {
  const rules = rulesFor(deps, baseRules)
  const refuse = (reason: keyof typeof RELEASE_REFUSAL): ReleaseCheck => ({ ok: false, reason, message: RELEASE_REFUSAL[reason] })
  const [evaluated, sentToday] = await Promise.all([evaluate(deps, now, rules, input.contactId), deps.countSentSince(startOfLocalDay(now, deps.timeZone))])
  const e = evaluated.find((x) => x.contactId === input.contactId)
  if (!e) return refuse('not_in_group')
  if (e.status !== 'due') return refuse(e.status)
  if (e.requestId !== input.requestId) return refuse('changed')
  if (sentToday >= rules.dailyMax) return refuse('daily_cap')
  const mail = await mailCheck(deps, e.contactId, e.bulkLast7Days, rules)
  if (!mail.ok) return { ok: false, reason: 'mail_check', message: `${mail.message}。这封没有发。` }
  return { ok: true }
}
