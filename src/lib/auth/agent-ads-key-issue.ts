/**
 * Issue one ads-agent key into the existing client_api_keys table.
 * Expiry is required. Plaintext is returned once and is not stored.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { generateApiKey, type GeneratedKey } from '@/lib/auth/api-key-access'
import {
  AGENT_ADS_KEY_MAX_DAYS,
  AGENT_ADS_SCOPE,
  isExactAgentAdsScope,
} from '@/lib/auth/agent-ads-scope'

const MAX_NAME_LEN = 80
const DAY_MS = 24 * 60 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ParsedKeyIssue {
  ok: true
  name: string
  expiresAt: string
}

export interface RejectedKeyIssue {
  ok: false
  status: 400
  code: string
  error: string
}

export function isClientUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function agentKeyIssueBlocked(input: {
  origin: string | null
  forwardedHost: string | null
  requestHost: string | null
}): boolean {
  if (!input.origin) return false
  let originHost: string
  try {
    originHost = new URL(input.origin).host
  } catch {
    return true
  }
  const selfHost = input.forwardedHost || input.requestHost || ''
  if (!selfHost) return true
  return originHost !== selfHost
}

export function parseAgentAdsKeyIssue(body: unknown, nowMs: number): ParsedKeyIssue | RejectedKeyIssue {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reject('invalid_body', '请求体不正确')
  }
  const record = body as Record<string, unknown>
  if ('scopes' in record) return reject('scopes_fixed', '这把钥匙的范围是固定的，不能指定')
  const name = typeof record.name === 'string' ? sanitiseName(record.name) : ''
  if (name.length === 0 || name.length > MAX_NAME_LEN) {
    return reject('invalid_name', '名称需要 1 到 80 个字，且不能含控制字符')
  }
  if (!('expires_at' in record)) return reject('missing_expiry', '必须填写失效时间')
  return parseExpiry(record.expires_at, nowMs, name)
}

export interface IssuedAgentAdsKey {
  plaintext: string
  key: {
    id: string
    name: string
    key_prefix: string
    scopes: string[]
    expires_at: string
    created_at: string
  }
}

export async function issueAgentAdsKey(input: {
  clientId: string
  name: string
  expiresAt: string
  createdByEmail: string | null
}): Promise<IssuedAgentAdsKey | null> {
  const fresh = generateApiKey()
  const inserted = await insertKey(input, fresh)
  if (!inserted) return null
  const scopes = scopeList(inserted.scopes)
  if (!isExactAgentAdsScope(scopes) || typeof inserted.expires_at !== 'string' || inserted.expires_at === '') {
    await revokeKey(inserted.id, input.clientId)
    return null
  }
  return { plaintext: fresh.plaintext, key: publicKey({ ...inserted, scopes }) }
}

export async function clientExists(clientId: string): Promise<boolean | 'error'> {
  const { data, error } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).maybeSingle()
  if (error) {
    console.error('[agent-ads] client lookup failed')
    return 'error'
  }
  return Boolean(data)
}

function parseExpiry(value: unknown, nowMs: number, name: string): ParsedKeyIssue | RejectedKeyIssue {
  if (typeof value !== 'string' || value.trim() === '') return reject('invalid_expiry', '失效时间不正确')
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return reject('invalid_expiry', '失效时间不正确')
  if (parsed <= nowMs) return reject('expiry_not_future', '失效时间必须晚于现在')
  if (parsed > nowMs + AGENT_ADS_KEY_MAX_DAYS * DAY_MS) {
    return reject('expiry_too_far', `失效时间不能超过 ${AGENT_ADS_KEY_MAX_DAYS} 天`)
  }
  return { ok: true, name, expiresAt: new Date(parsed).toISOString() }
}

function reject(code: string, error: string): RejectedKeyIssue {
  return { ok: false, status: 400, code, error }
}

function sanitiseName(input: string): string {
  return input.replace(/\p{C}/gu, '').trim()
}

interface InsertedKey {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  expires_at: string | null
  created_at: string
}

async function insertKey(
  input: { clientId: string; name: string; expiresAt: string; createdByEmail: string | null },
  fresh: GeneratedKey,
): Promise<InsertedKey | null> {
  const { data, error } = await supabaseAdmin
    .from('client_api_keys')
    .insert({
      client_id: input.clientId,
      key_hash: fresh.hash,
      key_prefix: fresh.prefix,
      name: input.name,
      scopes: [AGENT_ADS_SCOPE],
      expires_at: input.expiresAt,
      created_by_email: input.createdByEmail,
    })
    .select('id, name, key_prefix, scopes, expires_at, created_at')
    .single()
  if (error || !data) {
    console.error('[agent-ads] key insert failed')
    return null
  }
  return data as InsertedKey
}

async function revokeKey(id: string, clientId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('client_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('client_id', clientId)
  if (error) console.error('[agent-ads] key revoke after bad scope failed')
}

function scopeList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function publicKey(row: InsertedKey): IssuedAgentAdsKey['key'] {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    scopes: row.scopes,
    expires_at: row.expires_at ?? '',
    created_at: row.created_at,
  }
}
