import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppendResult, EmailSettings } from './types'
import { parseEmailSettingsStrict, serialiseEmailSettings } from './settings'

const TABLE = 'crm_email_settings'
const MAX_CHANGE_NOTE = 300
const DEFAULT_HISTORY_LIMIT = 20
const MAX_HISTORY_LIMIT = 100

export type LoadSettingsResult =
  | { kind: 'none' }
  | { kind: 'ok'; version: number; settings: EmailSettings }
  | { kind: 'invalid'; version: number; errors: string[] }

export interface AppendSettingsInput {
  clientId: string
  baseVersion: number | null
  settings: EmailSettings
  changeNote?: string | null
  createdBy: string
}

export interface SettingsHistoryEntry {
  version: number
  createdBy: string
  createdAt: string
  changeNote: string | null
}

interface SettingsRow {
  version: number
  settings: unknown
  created_by: string
  created_at: string
  change_note: string | null
}

function fail(what: string, message: string): Error {
  return new Error(`${TABLE}: ${what}: ${message}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${TABLE}: unreadable row`)
  }
  return value
}

function readRow(raw: unknown): SettingsRow {
  if (!isPlainObject(raw)) throw new Error(`${TABLE}: unreadable row`)
  const version = readVersion(raw.version)
  const createdBy = typeof raw.created_by === 'string' ? raw.created_by : ''
  const createdAt = typeof raw.created_at === 'string' ? raw.created_at : ''
  const changeNote = typeof raw.change_note === 'string' ? raw.change_note : null
  return { version, settings: raw.settings, created_by: createdBy, created_at: createdAt, change_note: changeNote }
}

async function fetchLatest(db: SupabaseClient, clientId: string): Promise<SettingsRow | null> {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw fail('load latest', error.message)
  const rows = Array.isArray(data) ? data : []
  if (rows.length === 0) return null
  return readRow(rows[0])
}

export async function loadEmailSettings(
  db: SupabaseClient,
  clientId: string,
): Promise<LoadSettingsResult> {
  const row = await fetchLatest(db, clientId)
  if (row === null) return { kind: 'none' }
  const parsed = parseEmailSettingsStrict(row.settings)
  if (!parsed.ok) {
    return { kind: 'invalid', version: row.version, errors: parsed.errors }
  }
  return { kind: 'ok', version: row.version, settings: parsed.settings }
}

function validateInput(input: AppendSettingsInput): string | null {
  const createdBy = input.createdBy
  if (typeof createdBy !== 'string' || createdBy.length < 3 || createdBy.length > 254 || !createdBy.includes('@')) {
    return 'createdBy 必须是 3 到 254 个字符且包含 @'
  }
  const note = input.changeNote
  if (note !== null && note !== undefined) {
    if (typeof note !== 'string' || note.length > MAX_CHANGE_NOTE) {
      return `changeNote 必须为空或不超过 ${MAX_CHANGE_NOTE} 个字符`
    }
  }
  const base = input.baseVersion
  if (base !== null) {
    if (typeof base !== 'number' || !Number.isInteger(base) || base < 1) {
      return 'baseVersion 必须为空或大于等于 1 的整数'
    }
  }
  return null
}

function serialiseAndCheck(settings: EmailSettings): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const serialised = serialiseEmailSettings(settings)
  const reparsed = parseEmailSettingsStrict(serialised)
  if (!reparsed.ok) {
    return { ok: false, message: reparsed.errors.slice(0, 3).join('; ') }
  }
  return { ok: true, value: serialised }
}

export async function appendEmailSettings(
  db: SupabaseClient,
  input: AppendSettingsInput,
): Promise<AppendResult<{ version: number }>> {
  const invalid = validateInput(input)
  if (invalid !== null) return { ok: false, reason: 'invalid', message: invalid }

  const serialised = serialiseAndCheck(input.settings)
  if (!serialised.ok) return { ok: false, reason: 'invalid', message: serialised.message }

  let latest: SettingsRow | null
  try {
    latest = await fetchLatest(db, input.clientId)
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) }
  }

  let version: number
  if (input.baseVersion === null) {
    if (latest !== null) {
      return { ok: false, reason: 'conflict', message: '设置刚被别人改过，请刷新后再改' }
    }
    version = 1
  } else {
    if (latest === null || latest.version !== input.baseVersion) {
      return { ok: false, reason: 'conflict', message: '设置刚被别人改过，请刷新后再改' }
    }
    version = input.baseVersion + 1
  }

  const row = {
    client_id: input.clientId,
    version,
    settings: serialised.value,
    change_note: input.changeNote ?? null,
    created_by: input.createdBy,
  }
  const { error } = await db.from(TABLE).insert(row).select('*').single()
  if (error) {
    if (error.code === '23505') {
      return { ok: false, reason: 'conflict', message: '设置刚被别人改过，请刷新后再改' }
    }
    return { ok: false, reason: 'error', message: error.message }
  }
  return { ok: true, value: { version } }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_HISTORY_LIMIT
  if (!Number.isFinite(limit)) return DEFAULT_HISTORY_LIMIT
  const n = Math.floor(limit)
  if (n < 1) return 1
  if (n > MAX_HISTORY_LIMIT) return MAX_HISTORY_LIMIT
  return n
}

export async function listSettingsHistory(
  db: SupabaseClient,
  clientId: string,
  limit?: number,
): Promise<SettingsHistoryEntry[]> {
  const n = clampLimit(limit)
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .order('version', { ascending: false })
    .limit(n)
  if (error) throw fail('list history', error.message)
  const rows = Array.isArray(data) ? data : []
  return rows.map((raw) => {
    const row = readRow(raw)
    return {
      version: row.version,
      createdBy: row.created_by,
      createdAt: row.created_at,
      changeNote: row.change_note,
    }
  })
}
