/**
 * "Please call me about this tour": a guest who came in through a tracked mail link asks, on the client's own website,
 * for a phone call on a day and part of the day they pick. Design: docs/specs/2026-11-17-cts-online-brochure-tracking-v0.md
 * §2.4 and §4 (slice 2).
 *
 * The request reaches a public, unauthenticated endpoint: everything in it is untrusted. The 12-character mail-link
 * token (which the client's site keeps in a first-party cookie after the guest's first click) is the only credential,
 * and only the mail's recipient has it. The worst a holder can do is ask for a call on that guest's own record.
 * Times are ME's own clock; the caller only picks a day and a part of the day from fixed choices.
 *
 * What it writes: one inbound website-form touch on the guest's record, carrying the chosen time as `callback_at`.
 * That single row is what makes the rest happen through existing rules, with no new wiring:
 *   - the AI follow-up stops and the guest goes back to staff (ai-takeover/came-back.ts: a website form counts);
 *   - the guest goes to the top of staff's list (segments.ts: an inbound newer than our last contact = "replied");
 *   - the chosen time shows on the call-back calendar (due-calendar.ts reads `metadata.callback_at`).
 *
 * Quiz answers are NOT stored on their own. A stand-alone website-form touch reads as "the guest reached out" in every
 * consumer of form touches (came-back, do-not-contact lift, repeat-enquiry), which a quiz is not. They travel only
 * inside a call-back request, where the guest really did reach out. Pure; the store does the reads and the write.
 */

import { TOKEN_RE } from '../email-templates/link-tracking/tag-links'
import { cleanPath, uaClass, type TokenInfo } from '../email-templates/link-tracking/record-click'
import { tzOffsetMs } from '../day-list'

export const SOURCE = 'site_callback_request'
export type CallWindow = 'morning' | 'afternoon' | 'evening'
const WINDOWS: readonly CallWindow[] = ['morning', 'afternoon', 'evening']
/** The local hour each part of the day is put on the call-back calendar at. */
export const WINDOW_HOUR: Readonly<Record<CallWindow, number>> = { morning: 10, afternoon: 14, evening: 18 }
const WINDOW_LABEL: Readonly<Record<CallWindow, string>> = { morning: '上午', afternoon: '下午', evening: '晚上' }
export const MAX_DAYS_AHEAD = 30
export const MAX_REQUESTS_PER_DAY = 3
const MAX_PICKS = 2

export type TripLength = '10' | '15' | '17'
export type Pace = 'easy' | 'full'
export interface QuizAnswers {
  length: TripLength
  firstVisit: boolean
  pace: Pace
  /** Tour page paths the quiz recommended, at most two. */
  picks: string[]
}

export interface CallbackReport {
  token: string
  /** YYYY-MM-DD on the client's wall clock. */
  date: string
  window: CallWindow
  /** The tour page the guest asked about, or null for "any tour". */
  tourPath: string | null
  ua: string
  quiz: QuizAnswers | null
}

export type ParsedCallback = { ok: true; report: CallbackReport } | { ok: false }

function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const t = Date.parse(`${value}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value
}

/** A tour page path (`/tours/...`), cleaned of everything but the path and a date; anything else is refused. */
function tourPathOf(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length > 300) return undefined
  const path = cleanPath(value)
  return path !== null && path.startsWith('/tours/') ? path.split('?')[0] : undefined
}

function parseQuiz(value: unknown): QuizAnswers | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const q = value as Record<string, unknown>
  const length = q.length === '10' || q.length === '15' || q.length === '17' ? q.length : null
  const pace = q.pace === 'easy' || q.pace === 'full' ? q.pace : null
  if (length === null || pace === null || typeof q.firstVisit !== 'boolean') return undefined
  if (!Array.isArray(q.picks) || q.picks.length > MAX_PICKS) return undefined
  const picks = q.picks.map(tourPathOf)
  if (picks.some((p) => typeof p !== 'string')) return undefined
  return { length, firstVisit: q.firstVisit, pace, picks: picks as string[] }
}

export function parseCallbackReport(body: Record<string, unknown> | null): ParsedCallback {
  if (body === null || typeof body.token !== 'string' || !TOKEN_RE.test(body.token)) return { ok: false }
  if (!isDay(body.date) || !WINDOWS.includes(body.window as CallWindow)) return { ok: false }
  const tourPath = tourPathOf(body.tourPath)
  const quiz = parseQuiz(body.quiz)
  if (tourPath === undefined || quiz === undefined) return { ok: false }
  const ua = typeof body.ua === 'string' && body.ua.length <= 400 ? body.ua : ''
  return { ok: true, report: { token: body.token, date: body.date as string, window: body.window as CallWindow, tourPath, ua, quiz } }
}

/** Today's date (YYYY-MM-DD) on the wall clock of `timeZone`. */
export function dayIn(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** The UTC instant of `hour`:00 on `day` on the wall clock of `timeZone` (offset taken at that local moment). */
export function wallTimeToUtc(day: string, hour: number, timeZone: string): string {
  const asUtc = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`)
  const firstGuess = asUtc - tzOffsetMs(new Date(asUtc), timeZone)
  return new Date(asUtc - tzOffsetMs(new Date(firstGuess), timeZone)).toISOString()
}

/** Null when the request can be recorded, else why not. Days from today to MAX_DAYS_AHEAD ahead, a real browser only. */
export function refusal(report: CallbackReport, now: Date, timeZone: string): 'not_browser' | 'bad_day' | null {
  if (uaClass(report.ua) !== 'browser') return 'not_browser'
  const today = dayIn(now, timeZone)
  if (report.date < today || report.date > addDays(today, MAX_DAYS_AHEAD)) return 'bad_day'
  return null
}

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** "11月20日周五". Built by hand: Intl's zh-CN date pieces differ between runtimes. */
function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日${WEEKDAY[d.getUTCDay()]}`
}

const LENGTH_LABEL: Readonly<Record<TripLength, string>> = { '10': '10 天左右', '15': '2 周左右', '17': '3 周左右或更长' }

/** One line for staff: what the guest answered and which tours the quiz suggested (names when known, else the path). */
export function quizLine(quiz: QuizAnswers, names: ReadonlyMap<string, string>): string {
  const answers = [LENGTH_LABEL[quiz.length], quiz.firstVisit ? '第一次去中国' : '去过中国', quiz.pace === 'easy' ? '想轻松一点' : '想多看一点']
  const picks = quiz.picks.map((p) => names.get(p) ?? p)
  return `选团小测：${answers.join('、')}${picks.length > 0 ? ` → 推荐 ${picks.join('、')}` : ''}`
}

export interface CallbackTouchRow {
  client_id: string
  contact_id: string
  channel: 'web_form'
  direction: 'inbound'
  occurred_at: string
  summary: string
  raw: string | null
  metadata: Record<string, unknown>
  source: typeof SOURCE
  source_ref: string
}

/** The touch row. `names` maps tour paths to tour names (missing = show the path). */
export function buildCallbackTouch(
  report: CallbackReport,
  info: TokenInfo,
  ctx: { now: Date; timeZone: string; names: ReadonlyMap<string, string> },
): CallbackTouchRow {
  const tourName = report.tourPath === null ? null : (ctx.names.get(report.tourPath) ?? report.tourPath)
  const when = `${dayLabel(report.date)} ${WINDOW_LABEL[report.window]}`
  return {
    client_id: info.clientId,
    contact_id: info.contactId,
    channel: 'web_form',
    direction: 'inbound',
    occurred_at: ctx.now.toISOString(),
    summary: `官网手册：客人请我们打电话 · ${when}${tourName === null ? '' : ` · 想聊 ${tourName}`}`,
    raw: report.quiz === null ? null : quizLine(report.quiz, ctx.names),
    metadata: {
      callback_at: wallTimeToUtc(report.date, WINDOW_HOUR[report.window], ctx.timeZone),
      callback_date: report.date,
      callback_window: report.window,
      tour_path: report.tourPath,
      quiz: report.quiz,
      mail_request_id: info.requestId,
    },
    source: SOURCE,
    // Re-sending the same choice (a double tap, a retry) is the same request: one row.
    source_ref: `${report.token}:${report.date}:${report.window}`,
  }
}

export interface CallbackStore {
  findToken(token: string): Promise<TokenInfo | null>
  /** True only when the mail this token was given to is recorded as sent. */
  mailWasSent(info: TokenInfo): Promise<boolean>
  timeZone(clientId: string): Promise<string>
  /** How many call-back requests this guest made at or after `sinceIso`. */
  requestsSince(clientId: string, contactId: string, sinceIso: string): Promise<number>
  /** Tour names for these tour paths, as far as the client's published tours know them. */
  tourNames(clientId: string, paths: readonly string[]): Promise<Map<string, string>>
  /** Inserts the row; a repeat of the same request is 'duplicate', never an error. */
  insertTouch(row: CallbackTouchRow): Promise<'inserted' | 'duplicate'>
}

export type CallbackOutcome = 'recorded' | 'duplicate' | 'ignored'

/** Records one request, or ignores it. Every "no" is silent: the caller learns nothing about the token. */
export async function recordCallbackRequest(report: CallbackReport, store: CallbackStore, now: Date): Promise<CallbackOutcome> {
  const info = await store.findToken(report.token)
  if (info === null || !(await store.mailWasSent(info))) return 'ignored'
  const timeZone = await store.timeZone(info.clientId)
  if (refusal(report, now, timeZone) !== null) return 'ignored'
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString()
  if ((await store.requestsSince(info.clientId, info.contactId, dayAgo)) >= MAX_REQUESTS_PER_DAY) return 'ignored'
  const paths = [report.tourPath, ...(report.quiz?.picks ?? [])].filter((p): p is string => p !== null)
  const names = paths.length === 0 ? new Map<string, string>() : await store.tourNames(info.clientId, paths)
  const outcome = await store.insertTouch(buildCallbackTouch(report, info, { now, timeZone, names }))
  return outcome === 'inserted' ? 'recorded' : 'duplicate'
}
