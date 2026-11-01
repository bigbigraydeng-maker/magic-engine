import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveChainStatus } from '@/lib/prescription-chain/derive'
import { loadChainBundle, serviceReader } from '@/lib/prescription-chain/load'
import type { ChainFacts } from '@/lib/prescription-chain/types'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { compareProjects, deriveProject } from './derive'
import type { ProjectFigures, ProjectInput, ProjectView } from './types'

const POOL = 4
const READ_CAP = 200

export type ProjectLoad =
  | { ok: true; projects: ProjectView[] }
  | { ok: false; message: string }

interface ClientRow {
  id: string
  name: string
}

interface RxRow {
  id: string
  clientId: string
  goalId: string | null
  intake: unknown
}

interface GoalMeta {
  title: string | null
  metricLabel: string | null
}

interface Side {
  scans: Set<string> | 'unread'
  pending: Set<string> | 'unread'
  goals: Map<string, GoalMeta> | 'unread'
}

export async function listConsoleClients(
  db: SupabaseClient,
  only: readonly string[] | null,
): Promise<{ ok: true; clients: ClientRow[] } | { ok: false; message: string }> {
  const clients = await readClients(db, only)
  if (clients === 'unread') return { ok: false, message: '客户名单没读到。刷新再看。' }
  return { ok: true, clients }
}

export async function loadProjects(
  db: SupabaseClient,
  scope: { clientIds: readonly string[] | null },
  nowIso: string,
): Promise<ProjectLoad> {
  const clients = await readClients(db, scope.clientIds)
  if (clients === 'unread') return { ok: false, message: '客户名单没读到。刷新再看。' }
  if (clients.length === 0) return { ok: true, projects: [] }
  const ids = clients.map((client) => client.id)
  const [prescriptions, side] = await Promise.all([
    readLatestPrescriptions(db, ids),
    readSide(db, ids),
  ])
  if (prescriptions === 'unread') return { ok: false, message: '处方名单没读到。刷新再看。' }
  const projects = await mapPool(clients, POOL, (client) => loadOne(db, client, prescriptions.get(client.id) ?? null, side, nowIso))
  projects.sort(compareProjects)
  return { ok: true, projects }
}

async function loadOne(
  db: SupabaseClient,
  client: ClientRow,
  rx: RxRow | null,
  side: Side,
  nowIso: string,
): Promise<ProjectView> {
  const bundle = rx ? await readBundle(db, client.id, rx.id, nowIso) : null
  const review = await readReview(db, client.id)
  const goal = goalOf(side.goals, rx?.goalId ?? null)
  return deriveProject(toInput(client, rx, side, bundle, review, goal))
}

function toInput(
  client: ClientRow,
  rx: RxRow | null,
  side: Side,
  bundle: { facts: ChainFacts; goLiveDraftIds: readonly string[] | 'unread' } | null | 'unread',
  review: ProjectInput['review'],
  goal: GoalMeta | null,
): ProjectInput {
  const chain = bundle && bundle !== 'unread' ? deriveChainStatus(bundle.facts) : null
  const facts = bundle && bundle !== 'unread' ? bundle.facts : null
  return {
    clientId: client.id,
    clientName: client.name,
    goalId: rx?.goalId ?? null,
    goalTitle: goal?.title ?? null,
    prescriptionId: rx?.id ?? null,
    brandScan: scanOf(side.scans, client.id),
    chain: bundle === 'unread' ? null : chain,
    pausedDraftPending: flagOf(side.pending, client.id),
    goLiveDraftIds: bundle === 'unread' ? 'unread' : (bundle?.goLiveDraftIds ?? []),
    review,
    figures: figuresOf(facts, currencyOf(rx?.intake), goal?.metricLabel ?? null, bundle === 'unread'),
  }
}

function scanOf(scans: Set<string> | 'unread', clientId: string): ProjectInput['brandScan'] {
  if (scans === 'unread') return 'unread'
  return scans.has(clientId) ? 'confirmed' : 'missing'
}

function flagOf(pending: Set<string> | 'unread', clientId: string): boolean | 'unread' {
  if (pending === 'unread') return 'unread'
  return pending.has(clientId)
}

function goalOf(goals: Map<string, GoalMeta> | 'unread', goalId: string | null): GoalMeta | null {
  if (!goalId || goals === 'unread') return null
  return goals.get(goalId) ?? null
}

function figuresOf(
  facts: ChainFacts | null,
  currency: string | null,
  metricLabel: string | null,
  bundleUnread: boolean,
): ProjectFigures | 'unread' {
  if (bundleUnread) return 'unread'
  if (!facts) return blankFigures(currency, metricLabel, false)
  const rxFailed = facts.prescription.read !== 'ok'
  const goalFailed = facts.goal.read === 'unread'
  const strategyFailed = facts.strategy.read !== 'ok'
  if (rxFailed && goalFailed && strategyFailed) return 'unread'
  const rx = facts.prescription.read === 'ok' ? facts.prescription.value : null
  const goal = facts.goal.read === 'ok' ? facts.goal.value : null
  const strategy = facts.strategy.read === 'ok' ? facts.strategy.value : null
  return {
    monthlyBudget: rx?.intake?.monthlyBudget ?? null,
    budgetCurrency: currency,
    metricLabel,
    targetValue: goal?.targetValue ?? null,
    currentValue: goal?.currentValue ?? null,
    dailyCapCents: strategy?.dailyCapCents ?? null,
    partial: rxFailed || goalFailed || strategyFailed,
  }
}

function blankFigures(currency: string | null, metricLabel: string | null, partial: boolean): ProjectFigures {
  return {
    monthlyBudget: null,
    budgetCurrency: currency,
    metricLabel,
    targetValue: null,
    currentValue: null,
    dailyCapCents: null,
    partial,
  }
}

async function readBundle(
  db: SupabaseClient,
  clientId: string,
  prescriptionId: string,
  nowIso: string,
): Promise<{ facts: ChainFacts; goLiveDraftIds: readonly string[] | 'unread' } | 'unread'> {
  try {
    return await loadChainBundle(serviceReader(db), { clientId, prescriptionId, nowIso })
  } catch {
    return 'unread'
  }
}

async function readClients(db: SupabaseClient, only: readonly string[] | null): Promise<ClientRow[] | 'unread'> {
  if (only && only.length === 0) return []
  let query = db.from('clients').select('id, name').order('name', { ascending: true })
  if (only) query = query.in('id', [...only])
  const { data, error } = await query
  if (error || !Array.isArray(data)) return 'unread'
  const rows: ClientRow[] = []
  for (const raw of data) {
    const row = asRecord(raw)
    if (!row || typeof row.id !== 'string') return 'unread'
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '这个客户还没有名字'
    rows.push({ id: row.id, name })
  }
  return rows
}

async function readLatestPrescriptions(db: SupabaseClient, clientIds: string[]): Promise<Map<string, RxRow> | 'unread'> {
  const { data, error } = await db
    .from('prescriptions')
    .select('id, client_id, goal_id, created_at, intake')
    .in('client_id', clientIds)
    .order('created_at', { ascending: false })
    .limit(READ_CAP + 1)
  if (error || !Array.isArray(data)) return 'unread'
  if (data.length > READ_CAP) return readLatestOneByOne(db, clientIds)
  const found = new Map<string, RxRow>()
  for (const raw of data) {
    const row = rxFrom(raw)
    if (!row) return 'unread'
    if (!found.has(row.clientId)) found.set(row.clientId, row)
  }
  return found
}

async function readLatestOneByOne(db: SupabaseClient, clientIds: string[]): Promise<Map<string, RxRow> | 'unread'> {
  const found = new Map<string, RxRow>()
  const rows = await mapPool(clientIds, POOL, async (clientId) => {
    const { data, error } = await db
      .from('prescriptions')
      .select('id, client_id, goal_id, created_at, intake')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return 'unread' as const
    if (!data) return null
    return rxFrom(data) ?? ('unread' as const)
  })
  for (const row of rows) {
    if (row === 'unread') return 'unread'
    if (row) found.set(row.clientId, row)
  }
  return found
}

function rxFrom(raw: unknown): RxRow | null {
  const row = asRecord(raw)
  if (!row || typeof row.id !== 'string' || typeof row.client_id !== 'string') return null
  const goalId = typeof row.goal_id === 'string' && row.goal_id.trim() ? row.goal_id : null
  return { id: row.id, clientId: row.client_id, goalId, intake: row.intake }
}

async function readSide(db: SupabaseClient, clientIds: string[]): Promise<Side> {
  const [scans, pending, goals] = await Promise.all([
    readScans(db, clientIds),
    readPending(db, clientIds),
    readGoals(db, clientIds),
  ])
  return { scans, pending, goals }
}

async function readScans(db: SupabaseClient, clientIds: string[]): Promise<Set<string> | 'unread'> {
  const { data, error } = await db
    .from('client_discovery')
    .select('client_id, confirmed_at')
    .in('client_id', clientIds)
    .not('confirmed_at', 'is', null)
    .limit(READ_CAP + 1)
  if (error || !Array.isArray(data) || data.length > READ_CAP) return 'unread'
  const found = new Set<string>()
  for (const raw of data) {
    const row = asRecord(raw)
    if (row && typeof row.client_id === 'string') found.add(row.client_id)
  }
  return found
}

async function readPending(db: SupabaseClient, clientIds: string[]): Promise<Set<string> | 'unread'> {
  const { data, error } = await db
    .from('action_runs')
    .select('client_id')
    .in('client_id', clientIds)
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .eq('status', 'pending_approval')
    .limit(READ_CAP + 1)
  if (error || !Array.isArray(data) || data.length > READ_CAP) return 'unread'
  const found = new Set<string>()
  for (const raw of data) {
    const row = asRecord(raw)
    if (row && typeof row.client_id === 'string') found.add(row.client_id)
  }
  return found
}

async function readGoals(db: SupabaseClient, clientIds: string[]): Promise<Map<string, GoalMeta> | 'unread'> {
  const { data, error } = await db
    .from('goals')
    .select('id, title, primary_metric_label')
    .in('client_id', clientIds)
    .limit(READ_CAP + 1)
  if (error || !Array.isArray(data) || data.length > READ_CAP) return 'unread'
  const found = new Map<string, GoalMeta>()
  for (const raw of data) {
    const row = asRecord(raw)
    if (!row || typeof row.id !== 'string') return 'unread'
    found.set(row.id, {
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null,
      metricLabel: typeof row.primary_metric_label === 'string' && row.primary_metric_label.trim()
        ? row.primary_metric_label.trim()
        : null,
    })
  }
  return found
}

async function readReview(db: SupabaseClient, clientId: string): Promise<ProjectInput['review']> {
  const { data, error } = await db
    .from('project_reviews')
    .select('created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return 'unread'
  const row = asRecord(data)
  if (!row) return null
  return typeof row.created_at === 'string' ? { createdAt: row.created_at } : 'unread'
}

function currencyOf(intake: unknown): string | null {
  const row = asRecord(intake)
  if (!row || typeof row.budget_currency !== 'string') return null
  const currency = row.budget_currency.trim()
  return currency || null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      out[index] = await fn(items[index] as T)
    }
  }
  const workers = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return out
}
