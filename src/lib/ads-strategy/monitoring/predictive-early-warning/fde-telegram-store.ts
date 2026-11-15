import type { SupabaseClient } from '@supabase/supabase-js'

/** Root key inside `clients.leads_config` on the anchor client (see env). */
export const FDE_TELEGRAM_LEADS_KEY = 'me_fde_telegram_v1'

export interface FdeTelegramStoreBlob {
  byPortalUserId: Record<string, { chatId: string; boundAt: string }>
  pending: Record<string, { portalUserId: string; expiresAt: string }>
}

const EMPTY: FdeTelegramStoreBlob = { byPortalUserId: {}, pending: {} }

export function readFdeTelegramStore(leadsConfig: unknown): FdeTelegramStoreBlob {
  const root =
    leadsConfig !== null && typeof leadsConfig === 'object' && !Array.isArray(leadsConfig)
      ? (leadsConfig as Record<string, unknown>)
      : null
  const raw = root?.[FDE_TELEGRAM_LEADS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY, byPortalUserId: {}, pending: {} }
  const blob = raw as Record<string, unknown>
  const byPortalUserId: FdeTelegramStoreBlob['byPortalUserId'] = {}
  const pending: FdeTelegramStoreBlob['pending'] = {}
  const by = blob.byPortalUserId
  if (by && typeof by === 'object' && !Array.isArray(by)) {
    for (const [id, row] of Object.entries(by as Record<string, unknown>)) {
      const r = row as Record<string, unknown>
      if (typeof r.chatId === 'string' && typeof r.boundAt === 'string') {
        byPortalUserId[id] = { chatId: r.chatId, boundAt: r.boundAt }
      }
    }
  }
  const pend = blob.pending
  if (pend && typeof pend === 'object' && !Array.isArray(pend)) {
    for (const [code, row] of Object.entries(pend as Record<string, unknown>)) {
      const r = row as Record<string, unknown>
      if (typeof r.portalUserId === 'string' && typeof r.expiresAt === 'string') {
        pending[code] = { portalUserId: r.portalUserId, expiresAt: r.expiresAt }
      }
    }
  }
  return { byPortalUserId, pending }
}

export function storeClientIdFromEnv(): string | null {
  const raw = process.env.ME_FDE_TELEGRAM_STORE_CLIENT_ID?.trim()
  return raw && raw.length > 0 ? raw : null
}

export async function loadFdeTelegramStore(sb: SupabaseClient): Promise<FdeTelegramStoreBlob | null> {
  const clientId = storeClientIdFromEnv()
  if (!clientId) return null
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) return null
  return readFdeTelegramStore((data as { leads_config?: unknown }).leads_config)
}

export async function patchFdeTelegramStore(
  sb: SupabaseClient,
  patch: Partial<FdeTelegramStoreBlob>,
): Promise<void> {
  const clientId = storeClientIdFromEnv()
  if (!clientId) throw new Error('ME_FDE_TELEGRAM_STORE_CLIENT_ID unset')
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error || !data) throw new Error(error?.message ?? 'anchor client missing')
  const base =
    (data as { leads_config?: unknown }).leads_config !== null &&
    typeof (data as { leads_config?: unknown }).leads_config === 'object' &&
    !Array.isArray((data as { leads_config?: unknown }).leads_config)
      ? ({ ...((data as { leads_config: Record<string, unknown> }).leads_config) } as Record<string, unknown>)
      : {}
  const current = readFdeTelegramStore(base)
  const next: FdeTelegramStoreBlob = {
    byPortalUserId: { ...current.byPortalUserId, ...(patch.byPortalUserId ?? {}) },
    pending: patch.pending !== undefined ? { ...patch.pending } : { ...current.pending },
  }
  const { error: wErr } = await sb
    .from('clients')
    .update({ leads_config: { ...base, [FDE_TELEGRAM_LEADS_KEY]: next } })
    .eq('id', clientId)
  if (wErr) throw new Error(wErr.message)
}

export function chatIdsForPortalUsers(
  store: FdeTelegramStoreBlob,
  portalUserIds: readonly string[],
): string[] {
  const out: string[] = []
  for (const id of portalUserIds) {
    const row = store.byPortalUserId[id]
    if (row?.chatId) out.push(row.chatId)
  }
  return Array.from(new Set(out))
}