/**
 * 今日待办：下一周整包该批了，或有条目被单独拦住。
 * 总闸关闭时一条都不发。读不到就说读不到，不说「没有」。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { toPublishedView } from '@/lib/factory/publish/publish-display'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { cadenceFromConfig, isWeekday, nzDateKey, targetWeek } from '@/lib/social/week-pack/cadence'
import { weekPackSubject } from '@/lib/social/week-pack/facts'
import { readHeldEvidence } from '@/lib/social/week-pack/persist-held'
import { weeklyPackApprovalEnabled, type WeekPackEnv } from '@/lib/social/week-pack/switches'
import type { WeekPackLine } from '@/lib/social/week-pack/types'

import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

const CARD_TTL_MS = 30 * 60 * 1000
const EXPIRING_MS = 20 * 60 * 1000
const LOOK_CAP = 200

export interface PendingCard {
  clientId: string
  subjectKey: string
  issuedAt: string
}

export interface HeldCount {
  clientId: string
  stories: number
  reels: number
}

export interface HandledPack {
  clientId: string
  subjectKey: string
}

export interface UnpublishedNote {
  clientId: string
  kind: 'story' | 'post' | 'reel'
  text: string
  stableId?: string | null
  code?: string
}

export interface PackEvidenceRow {
  clientId: string
  subjectKey: string
  evidence: unknown
}

export interface ItemRecovery {
  clientId: string
  storyAuthorizedAt: string | null
  storyRevokedAt: string | null
  videoState: 'DRAFT' | 'PUBLISHED' | null
  commentPending: boolean
}

export interface WeekPackTodoSource {
  configs: Array<{ id: string; name: string; config: unknown }> | 'unread'
  pending: PendingCard[] | 'unread'
  handled: HandledPack[] | 'unread'
  held: HeldCount[] | 'unread'
  unpublished: UnpublishedNote[] | 'unread'
}

/** A pack this client and week already agreed to, or already turned down. Expired and voided cards are not handled. */
export function readHandledPack(row: {
  clientId: string
  status: string
  subjectKey: string
  reason: string
}): HandledPack | null {
  if (!row.clientId || !row.subjectKey.startsWith('social:week-pack:')) return null
  if (row.status === 'authorized') return { clientId: row.clientId, subjectKey: row.subjectKey }
  if (row.status === 'denied' && row.reason.includes('不做') && !row.reason.includes('整包已停')) {
    return { clientId: row.clientId, subjectKey: row.subjectKey }
  }
  return null
}

export function buildWeekPackTodoItems(source: WeekPackTodoSource, now: Date, enabled: boolean): ManualItem[] {
  if (!enabled) return []
  const items: ManualItem[] = []
  if (source.configs === 'unread' || source.pending === 'unread' || source.handled === 'unread') {
    items.push(unreadable('今天读不到整包该不该批，不要当成没有人待批。', '打开一位客户的本周总览看「批下一周」。'))
  } else {
    items.push(...approvalItems(source.configs, source.pending, source.handled, now))
  }
  if (source.held === 'unread' || source.unpublished === 'unread') {
    items.push(unreadable('今天读不到有几条被单独拦住，不要当成 0 条。', '打开本周总览和 Story 页看被拦住的内容。'))
  } else {
    const names = source.configs === 'unread' ? [] : source.configs
    items.push(...heldItems(source.held, names))
    items.push(...unpublishedItems(source.unpublished, names))
  }
  return items
}

export async function pushWeekPackItems(
  supabase: SupabaseClient,
  bucket: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
  env: WeekPackEnv,
  clientIds: readonly string[],
): Promise<void> {
  if (!weeklyPackApprovalEnabled(env) || clientIds.length === 0) return
  const source = await loadWeekPackTodoSource(supabase, now, nameOf, clientIds)
  bucket.push(...buildWeekPackTodoItems(source, now, true))
}

async function loadWeekPackTodoSource(
  supabase: SupabaseClient,
  now: Date,
  nameOf: (id: string) => string,
  clientIds: readonly string[],
): Promise<WeekPackTodoSource> {
  const [configs, pending, handled, held, unpublished] = await Promise.all([
    loadConfigs(supabase, nameOf, clientIds),
    loadPending(supabase, clientIds, now),
    loadHandled(supabase, clientIds, now),
    loadHeld(supabase, now, clientIds),
    loadUnpublished(supabase, now, clientIds),
  ])
  return { configs, pending, handled, held, unpublished }
}

async function loadConfigs(
  supabase: SupabaseClient,
  nameOf: (id: string) => string,
  clientIds: readonly string[],
): Promise<WeekPackTodoSource['configs']> {
  const { data, error } = await supabase.from('clients').select('id, publishing_calendar_config').in('id', [...clientIds])
  if (error) return 'unread'
  return ((data ?? []) as Array<{ id?: unknown; publishing_calendar_config?: unknown }>).flatMap((row) => {
    if (typeof row.id !== 'string') return []
    return [{ id: row.id, name: nameOf(row.id), config: row.publishing_calendar_config ?? null }]
  })
}

async function loadPending(
  supabase: SupabaseClient,
  clientIds: readonly string[],
  now: Date,
): Promise<WeekPackTodoSource['pending']> {
  const rows = await readPackRuns(supabase, clientIds, ['pending_approval'], weekSubjects(clientIds, now))
  if (rows === 'unread') return 'unread'
  return rows.flatMap((row) => readPending(row as { client_id?: unknown; input?: unknown }))
}

function readPending(row: { client_id?: unknown; input?: unknown }): PendingCard[] {
  if (typeof row.client_id !== 'string') return []
  const input = row.input && typeof row.input === 'object' ? row.input as Record<string, unknown> : null
  const subjectKey = typeof input?.subject_key === 'string' ? input.subject_key : ''
  const issuedAt = typeof input?.issued_at === 'string' ? input.issued_at : ''
  if (!subjectKey.startsWith('social:week-pack:') || !issuedAt) return []
  return [{ clientId: row.client_id, subjectKey, issuedAt }]
}

async function loadHeld(
  supabase: SupabaseClient,
  now: Date,
  clientIds: readonly string[],
): Promise<WeekPackTodoSource['held']> {
  const week = targetWeek(now)
  const [stories, reels] = await Promise.all([
    countStories(supabase, week.weekStart, week.weekEnd, clientIds),
    countReels(supabase, now, clientIds),
  ])
  if (stories === 'unread' || reels === 'unread') return 'unread'
  return mergeHeld(stories, reels)
}

async function countStories(
  supabase: SupabaseClient,
  weekStart: string,
  weekEnd: string,
  clientIds: readonly string[],
): Promise<Map<string, number> | 'unread'> {
  const from = new Date(Date.parse(`${weekStart}T00:00:00Z`) - 2 * 86_400_000).toISOString()
  const to = new Date(Date.parse(`${weekEnd}T00:00:00Z`) + 3 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('story_items')
    .select('client_id, slot_at')
    .in('client_id', [...clientIds])
    .in('status', ['BLOCKED', 'FAILED', 'MISSED'])
    .gte('slot_at', from)
    .lt('slot_at', to)
    .limit(LOOK_CAP)
  if (error || (data ?? []).length >= LOOK_CAP) return 'unread'
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ client_id?: unknown; slot_at?: unknown }>) {
    if (typeof row.client_id !== 'string' || typeof row.slot_at !== 'string') continue
    const day = nzDateKey(row.slot_at)
    if (day < weekStart || day > weekEnd) continue
    counts.set(row.client_id, (counts.get(row.client_id) ?? 0) + 1)
  }
  return counts
}

async function countReels(
  supabase: SupabaseClient,
  now: Date,
  clientIds: readonly string[],
): Promise<Map<string, number> | 'unread'> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('client_id')
    .in('client_id', [...clientIds])
    .eq('status', 'publish_failed')
    .gte('updated_at', since)
    .limit(LOOK_CAP)
  if (error || (data ?? []).length >= LOOK_CAP) return 'unread'
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ client_id?: unknown }>) {
    if (typeof row.client_id !== 'string') continue
    counts.set(row.client_id, (counts.get(row.client_id) ?? 0) + 1)
  }
  return counts
}

function mergeHeld(stories: Map<string, number>, reels: Map<string, number>): HeldCount[] {
  const ids = new Set([...stories.keys(), ...reels.keys()])
  return [...ids].map((clientId) => ({
    clientId,
    stories: stories.get(clientId) ?? 0,
    reels: reels.get(clientId) ?? 0,
  }))
}

async function loadHandled(
  supabase: SupabaseClient,
  clientIds: readonly string[],
  now: Date,
): Promise<WeekPackTodoSource['handled']> {
  const rows = await readPackRuns(supabase, clientIds, ['authorized', 'denied'], weekSubjects(clientIds, now))
  if (rows === 'unread') return 'unread'
  const reasons = await decisionReasons(supabase, rows)
  if (reasons === 'unread') return 'unread'
  return rows.flatMap((row) => {
    const packed = readHandledPack(handledFields(row, reasons))
    return packed ? [packed] : []
  })
}

function handledFields(row: Record<string, unknown>, reasons: ReadonlyMap<string, string>): {
  clientId: string
  status: string
  subjectKey: string
  reason: string
} {
  const input = row.input && typeof row.input === 'object' ? row.input as Record<string, unknown> : null
  const decisionId = typeof row.authorization_decision_id === 'string' ? row.authorization_decision_id : ''
  return {
    clientId: typeof row.client_id === 'string' ? row.client_id : '',
    status: typeof row.status === 'string' ? row.status : '',
    subjectKey: typeof input?.subject_key === 'string' ? input.subject_key : '',
    reason: reasons.get(decisionId) ?? '',
  }
}

async function decisionReasons(
  supabase: SupabaseClient,
  rows: Array<Record<string, unknown>>,
): Promise<Map<string, string> | 'unread'> {
  const ids = rows.flatMap((row) => (
    row.status === 'denied' && typeof row.authorization_decision_id === 'string'
      ? [row.authorization_decision_id]
      : []
  ))
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.from('authorization_decisions').select('id, reason').in('id', ids)
  if (error) return 'unread'
  const reasons = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ id?: unknown; reason?: unknown }>) {
    if (typeof row.id === 'string') reasons.set(row.id, typeof row.reason === 'string' ? row.reason : '')
  }
  return reasons
}

function approvalItems(
  configs: Array<{ id: string; name: string; config: unknown }>,
  pending: PendingCard[],
  handled: HandledPack[],
  now: Date,
): ManualItem[] {
  const week = targetWeek(now)
  const items: ManualItem[] = []
  for (const client of configs) {
    const cadence = cadenceFromConfig(client.config)
    const subject = weekPackSubject(client.id, week.weekStart)
    if (handled.some((row) => row.clientId === client.id && row.subjectKey === subject)) continue
    const card = pending.find((row) => row.clientId === client.id && row.subjectKey === subject)
    const age = card ? now.getTime() - Date.parse(card.issuedAt) : null
    const fresh = age != null && age >= 0 && age < EXPIRING_MS
    const expiring = age != null && age >= EXPIRING_MS && age < CARD_TTL_MS
    if (isWeekday(now, cadence.approveWeekday) && !fresh) items.push(needsApproval(client, Boolean(card)))
    else if (expiring) items.push(needsApproval(client, true))
  }
  return items
}

function needsApproval(client: { id: string; name: string }, expiring: boolean): ManualItem {
  return {
    kind: 'week_pack_needs_approval',
    client_id: client.id,
    client_name: client.name,
    what: expiring
      ? '下一周的整包确认卡快过期了。过了就要重新打开页面，不批就不会按这张卡发。'
      : '下一周的社媒整包还没批。不批的话，到了发布日不会按这张卡发出去。',
    how: '打开本周总览，拉到「批下一周」，看完再点同意或先不发。',
    href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(client.id)}/daily-plan?tab=overview#approve-week`,
  }
}

const STORY_OPEN_CODES = new Set(['story_forbidden', 'story_failed'])
const REEL_OPEN_CODES = new Set(['preview_required', 'reel_failed', 'reel_forbidden', 'first_comment_failed'])

/**
 * Keep every pack failure for this client until that item recovers.
 * `now` does not choose a week: Friday's card must still show on Monday.
 */
export function notesForClients(
  rows: readonly PackEvidenceRow[],
  clientIds: readonly string[],
  now: Date,
): UnpublishedNote[] | 'unread' {
  if (Number.isNaN(now.getTime())) return 'unread'
  const allowed = new Set(clientIds)
  const notes: UnpublishedNote[] = []
  for (const row of rows) {
    if (!allowed.has(row.clientId)) continue
    if (!row.subjectKey.startsWith(`social:week-pack:${row.clientId.toLowerCase()}:`)) continue
    const parsed = readHeldEvidence(row.evidence)
    if (parsed === 'invalid') return 'unread'
    if (parsed === 'none') continue
    for (const line of parsed) notes.push(noteFromLine(row.clientId, line))
  }
  return notes
}

export function recoveryKey(clientId: string, kind: UnpublishedNote['kind'], stableId: string): string {
  return `${clientId.toLowerCase()}:${kind}:${stableId}`
}

export function stillNeedsReminder(note: UnpublishedNote, fact: ItemRecovery | null): boolean {
  if (!note.stableId || !note.code) return true
  if (!fact || fact.clientId !== note.clientId) return true
  if (STORY_OPEN_CODES.has(note.code)) return !storyRecovered(fact)
  if (note.code === 'first_comment_failed') return !commentRecovered(fact)
  if (REEL_OPEN_CODES.has(note.code)) return fact.videoState !== 'PUBLISHED'
  return true
}

export function openUnpublishedNotes(
  notes: readonly UnpublishedNote[],
  facts: ReadonlyMap<string, ItemRecovery>,
): UnpublishedNote[] {
  return notes.filter((note) => stillNeedsReminder(note, factFor(note, facts)))
}

function noteFromLine(clientId: string, line: WeekPackLine): UnpublishedNote {
  return { clientId, kind: line.kind, text: line.text, stableId: line.stable_id, code: line.code }
}

function storyRecovered(fact: ItemRecovery): boolean {
  return filled(fact.storyAuthorizedAt) && !filled(fact.storyRevokedAt)
}

function commentRecovered(fact: ItemRecovery): boolean {
  return fact.videoState === 'PUBLISHED' && fact.commentPending !== true
}

function filled(value: string | null): boolean {
  return typeof value === 'string' && value.length > 0
}

function factFor(note: UnpublishedNote, facts: ReadonlyMap<string, ItemRecovery>): ItemRecovery | null {
  if (!note.stableId) return null
  return facts.get(recoveryKey(note.clientId, note.kind, note.stableId)) ?? null
}

async function loadUnpublished(
  supabase: SupabaseClient,
  now: Date,
  clientIds: readonly string[],
): Promise<WeekPackTodoSource['unpublished']> {
  const cards = await loadAuthorizedCards(supabase, clientIds)
  if (cards === 'unread') return 'unread'
  const notes = notesForClients(cards, clientIds, now)
  if (notes === 'unread') return 'unread'
  const facts = await loadRecoveryFacts(supabase, notes, clientIds)
  if (facts === 'unread') return 'unread'
  return openUnpublishedNotes(notes, facts)
}

async function loadAuthorizedCards(
  supabase: SupabaseClient,
  clientIds: readonly string[],
): Promise<PackEvidenceRow[] | 'unread'> {
  const rows = await readPackRuns(supabase, clientIds, ['authorized'], 'all-weeks')
  if (rows === 'unread') return 'unread'
  return rows.flatMap((row) => readCard(row as { client_id?: unknown; input?: unknown; evidence?: unknown }))
}

function weekSubjects(clientIds: readonly string[], now: Date): string[] {
  const week = targetWeek(now)
  return clientIds.map((id) => weekPackSubject(id, week.weekStart))
}

type PackRunQuery = {
  eq: (column: string, value: unknown) => PackRunQuery
  in: (column: string, values: readonly unknown[]) => PackRunQuery
  like: (column: string, pattern: string) => PackRunQuery
  order: (column: string, options: { ascending: boolean }) => PackRunQuery
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}

/** Other clients and other confirmation cards stay out of this read, and a full page is not “unreadable”. */
async function readPackRuns(
  supabase: SupabaseClient,
  clientIds: readonly string[],
  statuses: readonly string[],
  subjects: readonly string[] | 'all-weeks',
): Promise<Array<Record<string, unknown>> | 'unread'> {
  if (clientIds.length === 0 || (subjects !== 'all-weeks' && subjects.length === 0)) return []
  const rows: Array<Record<string, unknown>> = []
  for (let page = 0; page < 25; page += 1) {
    const from = page * LOOK_CAP
    const { data, error } = await packRunQuery(supabase, clientIds, statuses, subjects).range(from, from + LOOK_CAP - 1)
    if (error) return 'unread'
    const batch = (data ?? []) as Array<Record<string, unknown>>
    rows.push(...batch)
    if (batch.length < LOOK_CAP) return rows
  }
  return 'unread'
}

function packRunQuery(
  supabase: SupabaseClient,
  clientIds: readonly string[],
  statuses: readonly string[],
  subjects: readonly string[] | 'all-weeks',
): PackRunQuery {
  const query = runs(supabase)
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .in('client_id', clientIds)
    .in('status', statuses)
  const scoped = subjects === 'all-weeks'
    ? query.like('input->>subject_key', 'social:week-pack:%')
    : query.in('input->>subject_key', subjects)
  return scoped.order('id', { ascending: true })
}

function runs(supabase: SupabaseClient): PackRunQuery {
  return supabase
    .from('action_runs')
    .select('client_id, status, input, evidence, authorization_decision_id') as unknown as PackRunQuery
}

function readCard(row: { client_id?: unknown; input?: unknown; evidence?: unknown }): PackEvidenceRow[] {
  if (typeof row.client_id !== 'string') return []
  const input = row.input && typeof row.input === 'object' ? row.input as Record<string, unknown> : null
  const subjectKey = typeof input?.subject_key === 'string' ? input.subject_key : ''
  if (!subjectKey.startsWith('social:week-pack:')) return []
  return [{ clientId: row.client_id, subjectKey, evidence: row.evidence }]
}

async function loadRecoveryFacts(
  supabase: SupabaseClient,
  notes: readonly UnpublishedNote[],
  clientIds: readonly string[],
): Promise<Map<string, ItemRecovery> | 'unread'> {
  const storyIds = idsFor(notes, 'story', STORY_OPEN_CODES)
  const reelIds = idsFor(notes, 'reel', REEL_OPEN_CODES)
  if (storyIds.length > LOOK_CAP || reelIds.length > LOOK_CAP) return 'unread'
  const [stories, reels] = await Promise.all([
    readStoryFacts(supabase, storyIds, clientIds),
    readReelFacts(supabase, reelIds, clientIds),
  ])
  if (stories === 'unread' || reels === 'unread') return 'unread'
  return new Map([...stories, ...reels])
}

function idsFor(
  notes: readonly UnpublishedNote[],
  kind: UnpublishedNote['kind'],
  codes: ReadonlySet<string>,
): string[] {
  const ids = new Set<string>()
  for (const note of notes) {
    if (note.kind === kind && note.stableId && note.code && codes.has(note.code)) ids.add(note.stableId)
  }
  return [...ids]
}

async function readStoryFacts(
  supabase: SupabaseClient,
  ids: readonly string[],
  clientIds: readonly string[],
): Promise<Map<string, ItemRecovery> | 'unread'> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from('story_packs')
    .select('id, client_id, authorized_at, revoked_at')
    .in('id', [...ids])
    .in('client_id', [...clientIds])
    .limit(LOOK_CAP)
  if (error || (data ?? []).length >= LOOK_CAP) return 'unread'
  return factsFrom(data, 'story', storyFact)
}

async function readReelFacts(
  supabase: SupabaseClient,
  ids: readonly string[],
  clientIds: readonly string[],
): Promise<Map<string, ItemRecovery> | 'unread'> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('id, client_id, published_ref')
    .in('id', [...ids])
    .in('client_id', [...clientIds])
    .limit(LOOK_CAP)
  if (error || (data ?? []).length >= LOOK_CAP) return 'unread'
  return factsFrom(data, 'reel', reelFact)
}

function factsFrom(
  data: unknown,
  kind: UnpublishedNote['kind'],
  read: (row: Record<string, unknown>) => { id: string; clientId: string; recovery: ItemRecovery } | null,
): Map<string, ItemRecovery> {
  const facts = new Map<string, ItemRecovery>()
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const fact = read(row)
    if (fact) facts.set(recoveryKey(fact.clientId, kind, fact.id), fact.recovery)
  }
  return facts
}

function storyFact(row: Record<string, unknown>): { id: string; clientId: string; recovery: ItemRecovery } | null {
  if (typeof row.id !== 'string' || typeof row.client_id !== 'string') return null
  return {
    id: row.id,
    clientId: row.client_id,
    recovery: {
      clientId: row.client_id,
      storyAuthorizedAt: typeof row.authorized_at === 'string' ? row.authorized_at : null,
      storyRevokedAt: typeof row.revoked_at === 'string' ? row.revoked_at : null,
      videoState: null,
      commentPending: false,
    },
  }
}

function reelFact(row: Record<string, unknown>): { id: string; clientId: string; recovery: ItemRecovery } | null {
  if (typeof row.id !== 'string' || typeof row.client_id !== 'string') return null
  const view = toPublishedView(row.published_ref)
  return {
    id: row.id,
    clientId: row.client_id,
    recovery: {
      clientId: row.client_id,
      storyAuthorizedAt: null,
      storyRevokedAt: null,
      videoState: view?.video_state ?? null,
      commentPending: view?.first_comment_pending === true,
    },
  }
}

function unpublishedItems(notes: UnpublishedNote[], configs: Array<{ id: string; name: string }>): ManualItem[] {
  const names = new Map(configs.map((client) => [client.id, client.name]))
  return notes.map((note) => ({
    kind: 'week_pack_items_held' as const,
    client_id: note.clientId,
    client_name: names.get(note.clientId) ?? '这位客户',
    what: heldWhat(note),
    how: heldHow(note),
    href: heldHref(note),
  }))
}

function heldWhat(note: UnpublishedNote): string {
  if (note.code === 'first_comment_failed') {
    return `整包已经点过同意。视频已经公开，第一条评论没有发出去。${note.text}`
  }
  return `整包已经点过同意，这一条没有发出去。${note.text}`
}

function heldHow(note: UnpublishedNote): string {
  if (note.code === 'first_comment_failed') return '视频已经公开。打开视频工厂，给这条补发第一条评论。'
  if (note.kind === 'reel') return '打开本周总览的「批下一周」。视频要先看过预览；没公开的去视频工厂逐条处理。'
  return '打开 Story 页。这一条要全局管理员才能授权，别的已经成功的不撤回。'
}

function heldHref(note: UnpublishedNote): string {
  if (note.code === 'first_comment_failed') return `${APP_BASE}/dashboard/factory`
  const path = note.kind === 'reel'
    ? `/dashboard/clients/${encodeURIComponent(note.clientId)}/daily-plan?tab=overview#approve-week`
    : `/dashboard/clients/${encodeURIComponent(note.clientId)}/story`
  return `${APP_BASE}${path}`
}

function heldItems(held: HeldCount[], configs: Array<{ id: string; name: string }>): ManualItem[] {
  const names = new Map(configs.map((client) => [client.id, client.name]))
  return held.filter((row) => row.stories + row.reels > 0).map((row) => ({
    kind: 'week_pack_items_held' as const,
    client_id: row.clientId,
    client_name: names.get(row.clientId) ?? '这位客户',
    what: `单独拦下 ${row.stories + row.reels} 条（Story ${row.stories} 条，视频 ${row.reels} 条），没有整包撤回。这些不会发出去。`,
    how: '打开 Story 页看被拦住的条目；视频没公开的，去视频工厂逐条处理。',
    href: row.stories > 0
      ? `${APP_BASE}/dashboard/clients/${encodeURIComponent(row.clientId)}/story`
      : `${APP_BASE}/dashboard/clients/${encodeURIComponent(row.clientId)}/daily-plan?tab=reels`,
  }))
}

function unreadable(what: string, how: string): ManualItem {
  return {
    kind: 'week_pack_needs_approval',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what,
    how,
    href: `${APP_BASE}/dashboard`,
  }
}
