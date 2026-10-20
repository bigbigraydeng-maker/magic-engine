/**
 * The only way publishing code obtains an Instagram credential.
 *
 * Fails closed on every doubt: switch off, no/ambiguous connection, grant without publish permission,
 * expired value, malformed account id. Renews a long-lived value before it dies (provider rule: only
 * unexpired values at least 24h old can be renewed; renewal starts a fresh 60 days) using an optimistic
 * lock on the expiry we read, and refuses to hand out a renewed value it could not save.
 *
 * Messages deliberately avoid the word "token" (error translators map it to "reconnect") and never include
 * provider text: renewal URLs carry the secret value.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { decryptToken, encryptToken, PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'
import { INSTAGRAM_PUBLISH_SCOPES, isInstagramAccountId, isInstagramPublishEnabled } from '@/lib/instagram-oauth/identity'
import { refreshInstagramToken } from '@/lib/instagram-oauth/client'

const DAY_MS = 24 * 60 * 60 * 1000
/** Start renewing this long before expiry; a publish retries hourly, so several chances remain. */
const RENEW_WITHIN_MS = 7 * DAY_MS

export type InstagramPublishTokenErrorCode =
  | 'disabled' | 'not_connected' | 'ambiguous' | 'needs_reauth' | 'invalid_account'
  | 'unavailable' | 'refresh_save_failed' | 'refresh_conflict'

const MESSAGES: Record<InstagramPublishTokenErrorCode, string> = {
  disabled: 'Instagram 发布未开启,已暂停发布',
  not_connected: '这个客户还没有连接 Instagram,已暂停发布',
  ambiguous: '存在多个 Instagram 授权,已暂停发布,请联系团队核实',
  needs_reauth: 'Instagram 授权已过期或缺少发布权限,请在客户设置里重新连接 Instagram',
  invalid_account: 'Instagram 授权记录里的账号编号无效,已暂停发布,请联系团队核实',
  unavailable: 'Instagram 授权暂时无法读取,已暂停发布,请稍后重试',
  refresh_save_failed: 'Instagram 授权续期后保存失败,已暂停发布,请稍后重试',
  refresh_conflict: 'Instagram 授权续期遇到并发冲突,已暂停发布,请稍后重试',
}

export class InstagramPublishTokenError extends Error {
  constructor(readonly code: InstagramPublishTokenErrorCode) {
    super(MESSAGES[code])
    this.name = 'InstagramPublishTokenError'
  }
}

interface ActiveRow {
  id: string
  account_id: string
  access_token_enc: string
  token_expiry: string | null
  scopes: string[] | null
}

export interface InstagramTokenDeps {
  enabled: () => boolean
  now: () => number
  listActive: (clientId: string) => Promise<ActiveRow[]>
  decrypt: (stored: string) => string
  encrypt: (value: string) => string
  refresh: (current: string) => Promise<{ accessToken: string; expiresIn: number } | null>
  /** Compare-and-swap on the expiry we read. Resolves to the number of rows changed; rejects on a database error. */
  saveRefreshed: (input: { id: string; expectedExpiry: string; accessTokenEnc: string; newExpiry: string }) => Promise<number>
}

async function listActive(clientId: string): Promise<ActiveRow[]> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, account_id, access_token_enc, token_expiry, scopes')
    .eq('client_id', clientId)
    .eq('provider', PLATFORM_PROVIDERS.INSTAGRAM)
    .eq('purpose', 'legacy')
    .eq('status', 'active')
    .limit(2)
  if (error) throw new Error('lookup failed')
  return (data ?? []) as ActiveRow[]
}

async function saveRefreshed(input: { id: string; expectedExpiry: string; accessTokenEnc: string; newExpiry: string }): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .update({ access_token_enc: input.accessTokenEnc, token_expiry: input.newExpiry, updated_at: new Date().toISOString() })
    .eq('id', input.id)
    .eq('token_expiry', input.expectedExpiry)
    .select('id')
  if (error) throw new Error('save failed')
  return data?.length ?? 0
}

const defaults: InstagramTokenDeps = {
  enabled: isInstagramPublishEnabled,
  now: Date.now,
  listActive,
  decrypt: decryptToken,
  encrypt: encryptToken,
  refresh: refreshInstagramToken,
  saveRefreshed,
}

function checkedRow(rows: ActiveRow[], now: number): ActiveRow & { expiryMs: number } {
  if (rows.length === 0) throw new InstagramPublishTokenError('not_connected')
  if (rows.length > 1) throw new InstagramPublishTokenError('ambiguous')
  const row = rows[0]
  const scopes = Array.isArray(row.scopes) ? row.scopes : []
  if (!INSTAGRAM_PUBLISH_SCOPES.every(scope => scopes.includes(scope))) throw new InstagramPublishTokenError('needs_reauth')
  const expiryMs = row.token_expiry ? Date.parse(row.token_expiry) : NaN
  if (!Number.isFinite(expiryMs) || expiryMs <= now) throw new InstagramPublishTokenError('needs_reauth')
  if (!isInstagramAccountId(row.account_id)) throw new InstagramPublishTokenError('invalid_account')
  return { ...row, expiryMs }
}

async function readRows(clientId: string, deps: InstagramTokenDeps): Promise<ActiveRow[]> {
  try { return await deps.listActive(clientId) } catch { throw new InstagramPublishTokenError('unavailable') }
}

function open(row: ActiveRow, deps: InstagramTokenDeps): string {
  try {
    const value = deps.decrypt(row.access_token_enc)
    if (value) return value
  } catch { /* fall through */ }
  throw new InstagramPublishTokenError('unavailable')
}

/** @throws {InstagramPublishTokenError} always this type; `code` says which doubt stopped the publish. */
export async function getInstagramPublishToken(
  clientId: string,
  deps: InstagramTokenDeps = defaults,
): Promise<{ accessToken: string; accountId: string }> {
  if (!deps.enabled()) throw new InstagramPublishTokenError('disabled')
  const row = checkedRow(await readRows(clientId, deps), deps.now())
  const current = open(row, deps)
  if (row.expiryMs - deps.now() > RENEW_WITHIN_MS) return { accessToken: current, accountId: row.account_id }

  const fresh = await deps.refresh(current).catch(() => null)
  // Renewal is best effort while the current value still has life (checkedRow guaranteed it does).
  if (!fresh) return { accessToken: current, accountId: row.account_id }

  let changed: number
  try {
    changed = await deps.saveRefreshed({
      id: row.id, expectedExpiry: row.token_expiry as string,
      accessTokenEnc: deps.encrypt(fresh.accessToken),
      newExpiry: new Date(deps.now() + fresh.expiresIn * 1000).toISOString(),
    })
  } catch { throw new InstagramPublishTokenError('refresh_save_failed') }
  if (changed === 1) return { accessToken: fresh.accessToken, accountId: row.account_id }

  // Another worker renewed first. Use its saved value once; if nothing changed, stop rather than guess.
  const again = checkedRow(await readRows(clientId, deps), deps.now())
  if (again.token_expiry === row.token_expiry) throw new InstagramPublishTokenError('refresh_conflict')
  return { accessToken: open(again, deps), accountId: again.account_id }
}
