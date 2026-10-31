/**
 * Per-client lesson audience.
 *
 * Stored on the existing `global_learned_lessons.evidence` jsonb object as
 * `pilot_client_ids`. No new column. Missing key = every client that already
 * matched scope (global behaviour). A present but unusable value matches
 * nobody, so a broken list cannot fall open to every client.
 *
 * The client id is never interpolated into a PostgREST filter string.
 */

export const PILOT_CLIENT_IDS_KEY = 'pilot_client_ids'

const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GLOBAL_LESSON_CAP = 25

export type AudienceMode = 'all' | 'off' | 'one'

export interface AudienceLesson {
  lesson_key?: string
  lesson: string
  evidence?: unknown
  confidence?: number
  confirmed_count?: number
  contradicted_count?: number
}

export interface AudienceStore {
  readLesson(lessonKey: string): Promise<{ found: boolean; evidence: unknown; error?: string }>
  clientExists(clientId: string): Promise<{ exists: boolean; error?: string }>
  writeLesson(
    lessonKey: string,
    isActive: boolean,
    evidence: Record<string, unknown>,
  ): Promise<{ error?: string }>
}

export type AudienceWrite =
  | { ok: true; isActive: boolean; audience: 'all' | 'off' | 'one' }
  | { ok: false; status: 400 | 404 | 500; error: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** null = unrestricted. A present list, including an unusable one, is a restriction. */
export function readPilotClientIds(evidence: unknown): string[] | null {
  if (!isPlainObject(evidence) || !Object.prototype.hasOwnProperty.call(evidence, PILOT_CLIENT_IDS_KEY)) {
    return null
  }
  const raw = evidence[PILOT_CLIENT_IDS_KEY]
  if (!Array.isArray(raw) || raw.length === 0) return []
  const ids: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return []
    const id = item.trim().toLowerCase()
    if (!CLIENT_ID_RE.test(id)) return []
    ids.push(id)
  }
  return ids
}

export function normaliseClientId(raw: string | undefined): string | null {
  const id = raw?.trim().toLowerCase() ?? ''
  return CLIENT_ID_RE.test(id) ? id : null
}

/** Unrestricted lessons stay visible. A restriction is an exact id match. */
export function lessonVisibleToClient(evidence: unknown, clientId: string): boolean {
  const ids = readPilotClientIds(evidence)
  if (ids === null) return true
  const needle = clientId.trim().toLowerCase()
  return needle !== '' && ids.includes(needle)
}

export function evidenceWithAudience(
  evidence: unknown,
  mode: AudienceMode,
  clientId?: string,
): { ok: true; isActive: boolean; evidence: Record<string, unknown> } | { ok: false; error: string } {
  const next = isPlainObject(evidence) ? { ...evidence } : {}
  delete next[PILOT_CLIENT_IDS_KEY]
  if (mode === 'off') return { ok: true, isActive: false, evidence: next }
  if (mode === 'all') return { ok: true, isActive: true, evidence: next }
  const id = normaliseClientId(clientId)
  if (!id) return { ok: false, error: '要先选一个客户' }
  next[PILOT_CLIENT_IDS_KEY] = [id]
  return { ok: true, isActive: true, evidence: next }
}

/** null = use the scope label. A string replaces it so the card cannot say "every client". */
export function lessonAudienceLabel(
  evidence: unknown,
  clientName: (id: string) => string | undefined,
): string | null {
  const ids = readPilotClientIds(evidence)
  if (ids === null) return null
  if (ids.length === 0) return '这份名单读不出来，谁的助手都不会用'
  const names = ids.map((id) => clientName(id)?.trim() || '一位客户')
  return `只给${names.join('、')}开着`
}

function dedupeLessons<T extends AudienceLesson>(rows: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    const key = row.lesson_key || row.lesson
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * Unrestricted lessons keep the old cap. A lesson named for this client is
 * appended after that cap so it is not crowded out, and it is absent for
 * every other client.
 */
export function selectLessonsForClient<T extends AudienceLesson>(rows: T[], clientId: string): T[] {
  const ranked = rows
    .filter((row) => lessonVisibleToClient(row.evidence, clientId))
    .filter((row) => (row.contradicted_count ?? 0) <= (row.confirmed_count ?? 1))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
  const unique = dedupeLessons(ranked)
  const open = unique.filter((row) => readPilotClientIds(row.evidence) === null).slice(0, GLOBAL_LESSON_CAP)
  const pilots = unique.filter((row) => readPilotClientIds(row.evidence) !== null)
  return [...open, ...pilots]
}

export function audienceFromToggle(
  body: Record<string, unknown>,
): { ok: true; mode: AudienceMode; clientId?: string } | { ok: false; error: string } {
  if (typeof body.only_client_id === 'string') {
    if (body.is_active === false) return { ok: false, error: '停用和只开一个客户不能同时做' }
    return { ok: true, mode: 'one', clientId: body.only_client_id }
  }
  if (typeof body.is_active !== 'boolean') return { ok: false, error: 'is_active must be true or false' }
  return { ok: true, mode: body.is_active ? 'all' : 'off' }
}

export async function applyLessonAudience(
  store: AudienceStore,
  input: { lessonKey: string; mode: AudienceMode; clientId?: string },
): Promise<AudienceWrite> {
  if (!input.lessonKey.trim()) return { ok: false, status: 400, error: '缺少经验' }
  if (input.mode === 'one' && !normaliseClientId(input.clientId)) {
    return { ok: false, status: 400, error: '要先选一个客户' }
  }
  const row = await store.readLesson(input.lessonKey)
  if (row.error) return { ok: false, status: 500, error: row.error }
  if (!row.found) return { ok: false, status: 404, error: '找不到这条经验' }
  const clientId = input.mode === 'one' ? normaliseClientId(input.clientId) ?? undefined : undefined
  if (input.mode === 'one' && clientId) {
    const client = await store.clientExists(clientId)
    if (client.error) return { ok: false, status: 500, error: client.error }
    if (!client.exists) return { ok: false, status: 404, error: '找不到这个客户' }
  }
  const next = evidenceWithAudience(row.evidence, input.mode, clientId)
  if (!next.ok) return { ok: false, status: 400, error: next.error }
  const saved = await store.writeLesson(input.lessonKey, next.isActive, next.evidence)
  if (saved.error) return { ok: false, status: 500, error: saved.error }
  const audience = input.mode === 'one' ? 'one' : input.mode
  return { ok: true, isActive: next.isActive, audience }
}
