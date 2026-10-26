import type { PrescriptionContent } from '@/types/diagnostic'
import type { SelfGrade } from '@/lib/huatuo/types'
import { readHuatuoStream } from '@/lib/huatuo/stream-client'

export const PRESCRIPTION_POLL_INTERVAL_MS = 2_000
const POLL_MAX_MS = 8 * 60 * 1000
const POLL_MAX_FAILURES = 5

export interface FollowedPrescription {
  ok: true
  prescriptionId: string
  content: PrescriptionContent
  selfGrade: SelfGrade | null
  status: string
  progressNote: string | null
  agentName: string | null
}

export interface FollowFailure {
  ok: false
  error: string
  prescriptionId?: string
}

export type FollowResult = FollowedPrescription | FollowFailure

export interface FollowHandlers {
  onStarted?: (prescriptionId: string) => void
  onProgress?: (note: string | null) => void
}

interface PollOptions extends FollowHandlers {
  clientId: string
  prescriptionId: string
  fetchImpl: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
  isCancelled?: () => boolean
}

interface Snapshot {
  id: string
  status: string
  content: PrescriptionContent | null
  selfGrade: SelfGrade | null
  progressNote: string | null
  errorMessage: string | null
  agentName: string | null
}

export async function followPrescriptionJob(
  response: Response,
  clientId: string,
  handlers: FollowHandlers = {},
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => number = () => Date.now(),
): Promise<FollowResult> {
  if (!response.ok && response.status !== 202) return { ok: false, error: await readError(response) }
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('text/event-stream')) return readSse(response, handlers)
  return followJson(response, clientId, handlers, fetchImpl, sleep, now)
}

export async function pollSettled(options: PollOptions): Promise<FollowResult> {
  const started = options.now()
  let failures = 0
  for (;;) {
    if (options.isCancelled?.()) return { ok: false, error: '' }
    const step = await onePoll(options)
    if (step === 'again') {
      failures = 0
    } else if (step === 'retry') {
      failures += 1
      if (failures >= POLL_MAX_FAILURES) {
        return { ok: false, error: '暂时查不到进度。请刷新，写好的处方会在上面。', prescriptionId: options.prescriptionId }
      }
    } else {
      return step
    }
    if (options.now() - started > POLL_MAX_MS) {
      return { ok: false, error: '写的时间比平时长。请过一会儿刷新。', prescriptionId: options.prescriptionId }
    }
    await options.sleep(PRESCRIPTION_POLL_INTERVAL_MS)
  }
}

async function onePoll(options: PollOptions): Promise<FollowResult | 'again' | 'retry'> {
  try {
    const snap = await readSnapshot(options.clientId, options.prescriptionId, options.fetchImpl)
    options.onProgress?.(snap.progressNote)
    const settled = interpretSnapshot(snap)
    return settled === 'wait' ? 'again' : settled
  } catch {
    return 'retry'
  }
}

async function followJson(
  response: Response,
  clientId: string,
  handlers: FollowHandlers,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<FollowResult> {
  const body = await response.json().catch(() => null)
  if (!isRecord(body)) return { ok: false, error: '没能开始写。' }
  if (body.success === false) return { ok: false, error: textOf(body.error) || '没能开始写。' }
  const id = typeof body.prescription_id === 'string' ? body.prescription_id : ''
  if (isContent(body.content) && id) {
    handlers.onStarted?.(id)
    return doneFrom(id, body.content, body)
  }
  if (!id) return { ok: false, error: '没能开始写。' }
  handlers.onStarted?.(id)
  if (body.status === 'generating' || response.status === 202) {
    return pollSettled({ clientId, prescriptionId: id, fetchImpl, sleep, now, onProgress: handlers.onProgress })
  }
  return { ok: false, error: '没能开始写。', prescriptionId: id }
}

async function readSse(response: Response, handlers: FollowHandlers): Promise<FollowResult> {
  let result: FollowResult = { ok: false, error: '写到一半断了。请刷新，写好的处方会在上面。' }
  await readHuatuoStream(response, {
    onStarted: (id) => handlers.onStarted?.(id),
    onProgress: (note) => handlers.onProgress?.(note),
    onDone: (payload) => {
      result = {
        ok: true,
        prescriptionId: payload.prescription_id,
        content: payload.content,
        selfGrade: payload.self_grade ?? null,
        status: 'draft',
        progressNote: null,
        agentName: 'huatuo',
      }
    },
    onError: (error) => {
      result = { ok: false, error }
    },
  })
  return result
}

function interpretSnapshot(snap: Snapshot): FollowResult | 'wait' {
  if (snap.status === 'generating') return 'wait'
  if (snap.status === 'failed') {
    return { ok: false, error: snap.errorMessage || '这版没写成。', prescriptionId: snap.id }
  }
  if ((snap.status === 'draft' || snap.status === 'approved') && snap.content) return doneFrom(snap.id, snap.content, snap)
  if (snap.status === 'draft' || snap.status === 'approved') return 'wait'
  return { ok: false, error: '处方状态对不上。请刷新再看。', prescriptionId: snap.id }
}

async function readSnapshot(clientId: string, prescriptionId: string, fetchImpl: typeof fetch): Promise<Snapshot> {
  const res = await fetchImpl(`/api/clients/${clientId}/prescription/${prescriptionId}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`transient ${res.status}`)
  const data = await res.json() as { prescription?: Record<string, unknown> }
  if (!data.prescription) throw new Error('missing prescription')
  return toSnapshot(prescriptionId, data.prescription)
}

function toSnapshot(id: string, row: Record<string, unknown>): Snapshot {
  return {
    id,
    status: textOf(row.status) || 'unknown',
    content: isContent(row.content) ? row.content : null,
    selfGrade: isRecord(row.self_grade) ? row.self_grade as unknown as SelfGrade : null,
    progressNote: textOf(row.progress_note),
    errorMessage: textOf(row.error_message),
    agentName: textOf(row.agent_name),
  }
}

function doneFrom(id: string, content: PrescriptionContent, extra: Record<string, unknown> | Snapshot): FollowedPrescription {
  const row = extra as Record<string, unknown>
  return {
    ok: true,
    prescriptionId: id,
    content,
    selfGrade: isRecord(row.selfGrade) || isRecord(row.self_grade)
      ? (row.selfGrade ?? row.self_grade) as SelfGrade
      : null,
    status: textOf(row.status) || 'draft',
    progressNote: textOf(row.progressNote ?? row.progress_note),
    agentName: textOf(row.agentName ?? row.agent_name),
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string }
    if (body?.error) return body.error
  } catch { /* body was not JSON */ }
  return '没能开始写。'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isContent(value: unknown): value is PrescriptionContent {
  return isRecord(value) && typeof value.summary === 'string' && Array.isArray(value.phases)
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
