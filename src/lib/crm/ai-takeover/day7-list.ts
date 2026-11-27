/**
 * The "第 7 天跟进信" page's list: guests in "AI 跟进中" due their one follow-up letter today (`day7.ts`). Read-only.
 * Each due guest also gets the same mail check the compose box runs (`previewCompose`): who it would go to, how many
 * mails they had in the last 7 days, or why it cannot go. Counts of the other states are returned so the page can say
 * plainly where everyone else is (no one silently missing).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import type { ComposePreview } from '@/lib/microsoft/mail-send-new'
import type { CameBackRow } from './came-back'
import { day7Status, type Day7Status } from './day7'

export interface Day7Row {
  contactId: string
  name: string
  /** Whole days since the catalogue went out. */
  day: number
  status: 'ready' | 'cannot_send'
  recipient: string | null
  sentLast7Days: number | null
  message: string | null
}

export interface Day7List {
  rows: Day7Row[]
  /** How many guests in AI follow-up are in each state today (due ones are the rows). */
  counts: Record<Day7Status, number>
}

export interface Day7ListDeps {
  loadTakeoverSince(): Promise<Map<string, string>>
  /** contactId → latest human click on a link in a mail we sent. */
  loadLastClicks(): Promise<Map<string, string>>
  loadNames(ids: string[]): Promise<Map<string, string>>
  compose(contactId: string): Promise<ComposePreview>
}

const PARALLEL_CHECKS = 8
const ID_CHUNK = 100

type TouchRow = CameBackRow & { contact_id: string }

async function loadTouches(sb: SupabaseClient, clientId: string, ids: readonly string[]): Promise<Map<string, CameBackRow[]>> {
  const out = new Map<string, CameBackRow[]>()
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK)
    const rows = await fetchAll<TouchRow>((from, to) =>
      sb.from('contact_touchpoints')
        .select('contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
        .eq('client_id', clientId)
        .in('contact_id', chunk)
        .order('occurred_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
    for (const r of rows) out.set(r.contact_id, [...(out.get(r.contact_id) ?? []), r])
  }
  return out
}

function emptyCounts(): Record<Day7Status, number> {
  return { due: 0, not_yet: 0, past_30: 0, came_back: 0, clicked: 0, already_written: 0 }
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

/** Today's due guests, oldest catalogue first, each with its mail check. */
export async function loadDay7List(sb: SupabaseClient, clientId: string, deps: Day7ListDeps, now: Date = new Date()): Promise<Day7List> {
  const since = await deps.loadTakeoverSince()
  const ids = [...since.keys()]
  const [touches, clicks] = await Promise.all([loadTouches(sb, clientId, ids), deps.loadLastClicks()])
  const counts = emptyCounts()
  const due: Array<{ contactId: string; day: number; since: string }> = []
  for (const id of ids) {
    const v = day7Status({ since: since.get(id) ?? '', touches: touches.get(id) ?? [], lastClickAt: clicks.get(id) ?? null }, now)
    counts[v.status] += 1
    if (v.status === 'due') due.push({ contactId: id, day: v.day, since: since.get(id) ?? '' })
  }
  due.sort((a, b) => Date.parse(a.since) - Date.parse(b.since))
  const names = await deps.loadNames(due.map((d) => d.contactId))
  const rows: Day7Row[] = due.map((d) => ({
    contactId: d.contactId, name: names.get(d.contactId) || '（没名字）', day: d.day,
    status: 'cannot_send', recipient: null, sentLast7Days: null, message: null,
  }))
  await checkMail(rows, deps)
  return { rows, counts }
}
