import type { SupabaseClient } from '@supabase/supabase-js'

/** No jsonb on `client_portal_users`; chats live in each customer's `clients.leads_config` by portal user id. */
export const FDE_TELEGRAM_CHATS_KEY = 'me_fde_telegram_chats'
export const FDE_TELEGRAM_PENDING_KEY = 'me_fde_telegram_pending_active'

export interface FdeTelegramChatRow {
  chatId: string
  boundAt: string
}

export interface FdeTelegramPendingActive {
  chatId: string
  code: string
  email: string
  expiresAt: string
  portalUserIds: string[]
}

export type ChatsByPortalUserId = Record<string, FdeTelegramChatRow>

function objectOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function readChatsByPortalUser(leadsConfig: unknown): ChatsByPortalUserId {
  const raw = objectOf(objectOf(leadsConfig)?.[FDE_TELEGRAM_CHATS_KEY])
  if (!raw) return {}
  const out: ChatsByPortalUserId = {}
  for (const [id, row] of Object.entries(raw)) {
    const r = objectOf(row)
    if (r && typeof r.chatId === 'string' && typeof r.boundAt === 'string') {
      out[id] = { chatId: r.chatId, boundAt: r.boundAt }
    }
  }
  return out
}

export function readPendingActive(leadsConfig: unknown): FdeTelegramPendingActive | null {
  const raw = objectOf(objectOf(leadsConfig)?.[FDE_TELEGRAM_PENDING_KEY])
  if (!raw || typeof raw.chatId !== 'string' || typeof raw.code !== 'string') return null
  if (typeof raw.email !== 'string' || typeof raw.expiresAt !== 'string') return null
  const portalUserIds = Array.isArray(raw.portalUserIds)
    ? raw.portalUserIds.filter((x): x is string => typeof x === 'string')
    : []
  return {
    chatId: raw.chatId,
    code: raw.code,
    email: raw.email,
    expiresAt: raw.expiresAt,
    portalUserIds,
  }
}

export async function patchClientLeadsConfig(
  sb: SupabaseClient,
  clientId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) throw new Error(error?.message ?? 'client missing')
  const base = objectOf((data as { leads_config?: unknown }).leads_config) ?? {}
  const { error: wErr } = await sb.from('clients').update({ leads_config: { ...base, ...patch } }).eq('id', clientId)
  if (wErr) throw new Error(wErr.message)
}

export function chatIdsFromChatsMap(
  chats: ChatsByPortalUserId,
  portalUserIds: readonly string[],
): string[] {
  const out: string[] = []
  for (const id of portalUserIds) {
    const row = chats[id]
    if (row?.chatId) out.push(row.chatId)
  }
  return Array.from(new Set(out))
}

export async function loadChatIdsForClientRecipients(
  sb: SupabaseClient,
  clientId: string,
  portalUserIds: readonly string[],
): Promise<string[]> {
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) return []
  return chatIdsFromChatsMap(
    readChatsByPortalUser((data as { leads_config?: unknown }).leads_config),
    portalUserIds,
  )
}

export async function findClientWithPendingForChat(
  sb: SupabaseClient,
  chatId: string,
): Promise<{ clientId: string; pending: FdeTelegramPendingActive; leadsConfig: Record<string, unknown> } | null> {
  const { data, error } = await sb
    .from('clients')
    .select('id, leads_config')
    .filter('leads_config->me_fde_telegram_pending_active->>chatId', 'eq', chatId)
    .limit(1)
  if (error || !data?.length) return null
  const row = data[0] as { id: string; leads_config: unknown }
  const pending = readPendingActive(row.leads_config)
  if (!pending || pending.chatId !== chatId) return null
  const leadsConfig = objectOf(row.leads_config) ?? {}
  return { clientId: row.id, pending, leadsConfig }
}