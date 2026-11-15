import { randomInt } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bareAddress, isInternalEmail } from '@/lib/ads-strategy/portfolio/diagnostics/internal-email'
import { sendTelegramBindCodeEmail, type BindMailer } from './fde-telegram-bind-email'
import {
  FDE_TELEGRAM_CHATS_KEY,
  FDE_TELEGRAM_PENDING_KEY,
  findClientWithPendingForChat,
  patchClientLeadsConfig,
  readChatsByPortalUser,
  type ChatsByPortalUserId,
  type FdeTelegramPendingActive,
} from './fde-telegram-persist'

const PENDING_TTL_MS = 15 * 60 * 1000

export interface FdePortalRow {
  id: string
  clientId: string
  email: string
}

export function parseStartEmail(text: string | undefined): 'bare_start' | string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (/^\/start(?:@\w+)?$/i.test(trimmed)) return 'bare_start'
  const m = trimmed.match(/^\/start(?:@\w+)?\s+(\S+)$/i)
  if (!m) return null
  const email = bareAddress(m[1].toLowerCase())
  return email.includes('@') ? email : null
}

export function parseConfirmCode(text: string | undefined): string | null {
  if (!text) return null
  const code = text.trim()
  return /^\d{6}$/.test(code) ? code : null
}

export async function listFdePortalRowsByEmail(sb: SupabaseClient, email: string): Promise<FdePortalRow[]> {
  const { data, error } = await sb
    .from('client_portal_users')
    .select('id, client_id, email, access_type')
    .ilike('email', email)
    .in('access_type', ['fde', 'both'])
  if (error) return []
  const out: FdePortalRow[] = []
  for (const row of (data ?? []) as Array<{ id?: string; client_id?: string; email?: string | null }>) {
    if (typeof row.id !== 'string' || typeof row.client_id !== 'string') continue
    const em = typeof row.email === 'string' ? bareAddress(row.email.trim()) : ''
    if (!em || !isInternalEmail(em) || em !== email) continue
    out.push({ id: row.id, clientId: row.client_id, email: em })
  }
  return out
}

function issueNumericCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export type StartBindResult =
  | { kind: 'help' }
  | { kind: 'unmatched' }
  | { kind: 'code_sent'; email: string }
  | { kind: 'mail_failed' }

export async function beginEmailTelegramBind(
  sb: SupabaseClient,
  chatId: string,
  email: string,
  mailer?: BindMailer | null,
  now = new Date(),
): Promise<StartBindResult> {
  if (!/^\d+$/.test(chatId)) return { kind: 'unmatched' }
  const rows = await listFdePortalRowsByEmail(sb, email)
  if (rows.length === 0) return { kind: 'unmatched' }
  const code = issueNumericCode()
  const mailStatus = await sendTelegramBindCodeEmail(email, code, mailer ?? undefined)
  if (mailStatus !== 'sent') return { kind: 'mail_failed' }
  const pending: FdeTelegramPendingActive = {
    chatId,
    code,
    email,
    expiresAt: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
    portalUserIds: rows.map((r) => r.id),
  }
  const clientIds = Array.from(new Set(rows.map((r) => r.clientId)))
  for (const clientId of clientIds) {
    await patchClientLeadsConfig(sb, clientId, { [FDE_TELEGRAM_PENDING_KEY]: pending })
  }
  return { kind: 'code_sent', email }
}

export type ConfirmBindResult =
  | { kind: 'bound'; email: string; rebound: boolean }
  | { kind: 'wrong_code' }
  | { kind: 'expired' }
  | { kind: 'no_pending' }

export async function confirmTelegramBind(
  sb: SupabaseClient,
  chatId: string,
  code: string,
  now = new Date(),
): Promise<ConfirmBindResult> {
  const found = await findClientWithPendingForChat(sb, chatId)
  if (!found) return { kind: 'no_pending' }
  const { pending } = found
  if (new Date(pending.expiresAt).getTime() < now.getTime()) {
    await clearPendingForEmail(sb, pending.email)
    return { kind: 'expired' }
  }
  if (pending.code !== code) return { kind: 'wrong_code' }
  const rows = await listFdePortalRowsByEmail(sb, pending.email)
  if (rows.length === 0) return { kind: 'no_pending' }
  const boundAt = now.toISOString()
  let rebound = false
  const rowsByClient = new Map<string, FdePortalRow[]>()
  for (const row of rows) {
    const list = rowsByClient.get(row.clientId) ?? []
    list.push(row)
    rowsByClient.set(row.clientId, list)
  }
  for (const [clientId, clientRows] of rowsByClient) {
    const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
    if (error || !data) continue
    const base =
      (data as { leads_config?: unknown }).leads_config !== null &&
      typeof (data as { leads_config?: unknown }).leads_config === 'object' &&
      !Array.isArray((data as { leads_config?: unknown }).leads_config)
        ? ({ ...((data as { leads_config: Record<string, unknown> }).leads_config) } as Record<string, unknown>)
        : {}
    const chats: ChatsByPortalUserId = { ...readChatsByPortalUser(base) }
    for (const row of clientRows) {
      const prior = chats[row.id]
      if (prior && prior.chatId !== chatId) rebound = true
      chats[row.id] = { chatId, boundAt }
    }
    const next = { ...base, [FDE_TELEGRAM_CHATS_KEY]: chats }
    delete next[FDE_TELEGRAM_PENDING_KEY]
    const { error: wErr } = await sb.from('clients').update({ leads_config: next }).eq('id', clientId)
    if (wErr) throw new Error(wErr.message)
  }
  return { kind: 'bound', email: pending.email, rebound }
}

async function clearPendingForEmail(sb: SupabaseClient, email: string): Promise<void> {
  const rows = await listFdePortalRowsByEmail(sb, email)
  for (const clientId of new Set(rows.map((r) => r.clientId))) {
    const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
    if (error || !data) continue
    const base =
      (data as { leads_config?: unknown }).leads_config !== null &&
      typeof (data as { leads_config?: unknown }).leads_config === 'object' &&
      !Array.isArray((data as { leads_config?: unknown }).leads_config)
        ? ({ ...((data as { leads_config: Record<string, unknown> }).leads_config) } as Record<string, unknown>)
        : {}
    const next = { ...base }
    delete next[FDE_TELEGRAM_PENDING_KEY]
    await sb.from('clients').update({ leads_config: next }).eq('id', clientId)
  }
}