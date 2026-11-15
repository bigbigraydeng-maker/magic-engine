import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isInternalEmail } from '@/lib/ads-strategy/portfolio/diagnostics/internal-email'
import {
  loadFdeTelegramStore,
  patchFdeTelegramStore,
  type FdeTelegramStoreBlob,
} from './fde-telegram-store'

const BIND_CODE_TTL_MS = 30 * 60 * 1000

export function normalizeBindCode(raw: string): string | null {
  const code = raw.trim().toLowerCase()
  return /^[a-f0-9]{8}$/.test(code) ? code : null
}

export function issueBindCode(_portalUserId: string): string {
  const code = createHash('sha256')
    .update(randomBytes(16))
    .digest('hex')
    .slice(0, 8)
  return code
}

export async function assertBindableFdePortalUser(sb: SupabaseClient, portalUserId: string): Promise<void> {
  const { data, error } = await sb
    .from('client_portal_users')
    .select('id, email, access_type')
    .eq('id', portalUserId)
    .maybeSingle()
  if (error || !data) throw new Error('portal user not found')
  const access = (data as { access_type?: string }).access_type
  if (access !== 'fde' && access !== 'both') throw new Error('not an FDE portal user')
  const email = (data as { email?: string | null }).email
  if (typeof email !== 'string' || !isInternalEmail(email)) throw new Error('FDE email must be internal')
}

export async function createFdeTelegramBindCode(
  sb: SupabaseClient,
  portalUserId: string,
  now = new Date(),
): Promise<{ code: string; expiresAt: string }> {
  await assertBindableFdePortalUser(sb, portalUserId)
  const store = (await loadFdeTelegramStore(sb)) ?? { byPortalUserId: {}, pending: {} }
  const code = issueBindCode(portalUserId)
  const expiresAt = new Date(now.getTime() + BIND_CODE_TTL_MS).toISOString()
  const pending: FdeTelegramStoreBlob['pending'] = { ...store.pending, [code]: { portalUserId, expiresAt } }
  await patchFdeTelegramStore(sb, { pending })
  return { code, expiresAt }
}

export type BindStartResult =
  | { ok: true; portalUserId: string }
  | { ok: false; reason: 'invalid_code' | 'expired' | 'store_unconfigured' }

export async function completeBindFromStartCommand(
  sb: SupabaseClient,
  codeRaw: string,
  chatId: string,
  now = new Date(),
): Promise<BindStartResult> {
  const code = normalizeBindCode(codeRaw)
  if (!code || !/^\d+$/.test(chatId)) return { ok: false, reason: 'invalid_code' }
  const store = await loadFdeTelegramStore(sb)
  if (!store) return { ok: false, reason: 'store_unconfigured' }
  const pending = store.pending[code]
  if (!pending) return { ok: false, reason: 'invalid_code' }
  if (new Date(pending.expiresAt).getTime() < now.getTime()) {
    const nextPending = { ...store.pending }
    delete nextPending[code]
    await patchFdeTelegramStore(sb, { pending: nextPending })
    return { ok: false, reason: 'expired' }
  }
  const portalUserId = pending.portalUserId
  await assertBindableFdePortalUser(sb, portalUserId)
  const nextPending = { ...store.pending }
  delete nextPending[code]
  const byPortalUserId = {
    ...store.byPortalUserId,
    [portalUserId]: { chatId, boundAt: now.toISOString() },
  }
  await patchFdeTelegramStore(sb, { pending: nextPending, byPortalUserId })
  return { ok: true, portalUserId }
}

export function parseTelegramStartPayload(text: string | undefined): string | null {
  if (!text) return null
  const m = text.trim().match(/^\/start(?:@\w+)?\s+([a-f0-9]{8})$/i)
  return m ? normalizeBindCode(m[1]) : null
}