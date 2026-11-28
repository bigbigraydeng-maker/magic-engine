/**
 * The "第 7 天跟进信" page's list: guests in "AI 跟进中" due their one follow-up letter today (`day7.ts`). Read-only.
 *
 * Reads the same inputs the daily stop line reads (`loadClientInputs`) and judges the stop line live for each guest,
 * so a guest booked, marked do-not-contact, moved to a stopping stage, back in touch or talked to since this morning
 * never gets a "did the brochure reach you?" letter (review 子牙 P1-4 / 魏征 P1-3).
 * Each due guest gets the compose box's own mail check (`previewCompose`) and a request id fixed per guest and round
 * of follow-up (`day7RequestId`): the send route refuses a second send with the same id, from any tab or person
 * (魏征 P1-2). Every read throws on error: this list decides who is written to, so a half read is no list at all.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { uuidFromSeed } from '@/lib/crm/stable-uuid'
import type { ComposePreview } from '@/lib/microsoft/mail-send-new'
import { day7Status, type Day7Status } from './day7'
import { loadClientInputs, stopDecisionFor, stopLineContext } from './stop-line-run'

export interface Day7Row {
  contactId: string
  name: string
  /** Client-local calendar days since the catalogue went out. */
  day: number
  status: 'ready' | 'cannot_send'
  recipient: string | null
  sentLast7Days: number | null
  message: string | null
  /** The one request id for this guest's day-7 letter in this round of follow-up. */
  requestId: string
}

export interface Day7List {
  rows: Day7Row[]
  /** How many guests in AI follow-up are in each state today (due ones are the rows). */
  counts: Record<Day7Status, number>
}

export interface Day7ListDeps {
  timeZone: string
  /** contactId → latest human click on a link in a mail we sent (60 days). Throws on a read error. */
  loadLastClicks(): Promise<Map<string, string>>
  /** contactId → latest send of ours in the send log (pending or sent) for these guests. Throws on a read error. */
  loadLastSends(contactIds: readonly string[]): Promise<Map<string, string>>
  loadNames(ids: string[]): Promise<Map<string, string>>
  compose(contactId: string): Promise<ComposePreview>
}

const PARALLEL_CHECKS = 8

/** A stable UUID for one guest's day-7 letter in one round of follow-up. */
export function day7RequestId(contactId: string, since: string): string {
  return uuidFromSeed(`day7-followup:${contactId}:${Date.parse(since)}`)
}

function emptyCounts(): Record<Day7Status, number> {
  return { due: 0, not_yet: 0, past_30: 0, stopped: 0, clicked: 0, already_written: 0 }
}

async function checkMail(rows: Day7Row[], deps: Day7ListDeps): Promise<void> {
  for (let i = 0; i < rows.length; i += PARALLEL_CHECKS) {
    const batch = rows.slice(i, i + PARALLEL_CHECKS)
    const results = await Promise.all(batch.map((r) => deps.compose(r.contactId)))
    batch.forEach((r, k) => {
      const c = results[k]
      if (c.canCompose) Object.assign(r, { status: 'ready', recipient: c.recipient, sentLast7Days: c.sentToContactLast7Days, message: null })
      else Object.assign(r, { status: 'cannot_send', recipient: null, sentLast7Days: null, message: c.message })
    })
  }
}

/** Today's due guests, oldest catalogue first, each with its mail check and fixed request id. */
export async function loadDay7List(sb: SupabaseClient, clientId: string, deps: Day7ListDeps, now: Date = new Date()): Promise<Day7List> {
  const inputs = await loadClientInputs(sb, clientId)
  const ctx = stopLineContext(inputs)
  const ids = inputs.guests.map((g) => g.id)
  const [clicks, sends] = await Promise.all([deps.loadLastClicks(), deps.loadLastSends(ids)])
  const counts = emptyCounts()
  const due: Array<{ contactId: string; day: number; since: string }> = []
  for (const g of inputs.guests) {
    const v = day7Status({
      since: g.ai_takeover_since,
      touches: ctx.touchesOf.get(g.id) ?? [],
      lastClickAt: clicks.get(g.id) ?? null,
      lastSendAt: sends.get(g.id) ?? null,
      // A stage missing from the client's stage list cannot be judged: leave the guest to staff (魏征 R2 P2).
      stopped: stopDecisionFor(g, ctx, now) !== null || (g.stage !== null && g.stage !== '' && !ctx.stageOf.has(g.stage)),
      timeZone: deps.timeZone,
    }, now)
    counts[v.status] += 1
    if (v.status === 'due') due.push({ contactId: g.id, day: v.day, since: g.ai_takeover_since })
  }
  due.sort((a, b) => Date.parse(a.since) - Date.parse(b.since))
  const names = await deps.loadNames(due.map((d) => d.contactId))
  const rows: Day7Row[] = due.map((d) => ({
    contactId: d.contactId, name: names.get(d.contactId) || '（没名字）', day: d.day,
    status: 'cannot_send', recipient: null, sentLast7Days: null, message: null, requestId: day7RequestId(d.contactId, d.since),
  }))
  await checkMail(rows, deps)
  return { rows, counts }
}

const ID_CHUNK = 100

/** contactId → latest pending / sent e-mail of ours in the send log (`conversation_outbound_log`), for these guests. */
export async function loadLastSendsFromLog(sb: SupabaseClient, clientId: string, contactIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < contactIds.length; i += ID_CHUNK) {
    const convos = await fetchAll<{ id: string; contact_id: string }>((from, to) =>
      sb.from('conversations').select('id, contact_id').eq('client_id', clientId).eq('channel', 'email')
        .in('contact_id', contactIds.slice(i, i + ID_CHUNK)).order('id', { ascending: true }).range(from, to),
    )
    const owner = new Map(convos.map((c) => [c.id, c.contact_id]))
    for (let j = 0; j < convos.length; j += ID_CHUNK) {
      const logs = await fetchAll<{ id: string; conversation_id: string; created_at: string }>((from, to) =>
        sb.from('conversation_outbound_log').select('id, conversation_id, created_at').eq('client_id', clientId)
          .in('conversation_id', convos.slice(j, j + ID_CHUNK).map((c) => c.id)).in('status', ['pending', 'sent'])
          .order('id', { ascending: true }).range(from, to),
      )
      for (const l of logs) {
        const contact = owner.get(l.conversation_id)
        if (contact === undefined) continue
        const prev = out.get(contact)
        if (prev === undefined || Date.parse(l.created_at) > Date.parse(prev)) out.set(contact, l.created_at)
      }
    }
  }
  return out
}

/** contactId → latest human click on a link in a mail we sent, last 60 days, every page. Throws on a read error. */
export async function loadLastClicksStrict(sb: SupabaseClient, clientId: string, now: Date): Promise<Map<string, string>> {
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString()
  const rows = await fetchAll<{ id: string; contact_id: string; occurred_at: string }>((from, to) =>
    sb.from('crm_email_link_clicks').select('id, contact_id, occurred_at').eq('client_id', clientId).eq('counts_as_human', true)
      .gte('occurred_at', since).order('id', { ascending: true }).range(from, to),
  )
  const out = new Map<string, string>()
  for (const r of rows) if (!out.has(r.contact_id) || Date.parse(r.occurred_at) > Date.parse(out.get(r.contact_id) ?? '')) out.set(r.contact_id, r.occurred_at)
  return out
}
