import type { SupabaseClient } from '@supabase/supabase-js'

const MIGRATION_GOAL = '[Migration] Unassigned Backlog'

export interface StartGoal {
  id: string
  title: string
}

export type StartScan = 'confirmed' | 'missing' | 'unread'

export type StartChoices =
  | { ok: false; message: string }
  | { ok: true; clientName: string; goals: StartGoal[]; scan: StartScan }

/** Clients and goals to hand to the existing prescription dialog. Does not generate anything. */
export async function loadStartChoices(db: SupabaseClient, clientId: string): Promise<StartChoices> {
  const client = await readClient(db, clientId)
  if (client === 'unread') return { ok: false, message: '这个客户没读到。刷新再看。' }
  if (!client) return { ok: false, message: '没有这个客户。' }
  const [goals, scan] = await Promise.all([readGoals(db, clientId), readScan(db, clientId)])
  if (goals === 'unread') return { ok: false, message: '目标没读到。刷新再看。' }
  return { ok: true, clientName: client, goals, scan }
}

async function readClient(db: SupabaseClient, clientId: string): Promise<string | null | 'unread'> {
  const { data, error } = await db.from('clients').select('name').eq('id', clientId).maybeSingle()
  if (error) return 'unread'
  if (!data) return null
  const name = (data as { name?: unknown }).name
  return typeof name === 'string' && name.trim() ? name.trim() : '这个客户还没有名字'
}

async function readGoals(db: SupabaseClient, clientId: string): Promise<StartGoal[] | 'unread'> {
  const { data, error } = await db
    .from('goals')
    .select('id, title, status')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (error || !Array.isArray(data)) return 'unread'
  const goals: StartGoal[] = []
  for (const raw of data) {
    const row = raw as { id?: unknown; title?: unknown }
    if (typeof row.id !== 'string') return 'unread'
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    if (!title || title === MIGRATION_GOAL) continue
    goals.push({ id: row.id, title })
  }
  return goals
}

async function readScan(db: SupabaseClient, clientId: string): Promise<StartScan> {
  const { data, error } = await db
    .from('client_discovery')
    .select('confirmed_at')
    .eq('client_id', clientId)
    .not('confirmed_at', 'is', null)
    .order('confirmed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return 'unread'
  const confirmed = (data as { confirmed_at?: unknown } | null)?.confirmed_at
  return typeof confirmed === 'string' && confirmed.trim() ? 'confirmed' : 'missing'
}
