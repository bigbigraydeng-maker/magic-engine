import { storedEffectCard, type EffectJudgmentCard } from '@/lib/ads-strategy/effect-judgment/card'
import type { PrescriptionContent } from '@/types/diagnostic'
import type { SelfGrade } from '@/lib/huatuo/types'
import { readHuatuoStream } from '@/lib/huatuo/stream-client'
import { pollHuatuoPrescription } from '@/lib/huatuo/poll-prescription'

export interface FollowedPrescription {
  ok: true
  prescriptionId: string
  content: PrescriptionContent
  selfGrade: SelfGrade | null
  status: string
  progressNote: string | null
  agentName: string | null
  effectCard: EffectJudgmentCard | null
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

// Polling is the shared #3227 implementation; this only maps its outcome to the dialog's shape.
export async function pollSettled(options: PollOptions): Promise<FollowResult> {
  const outcome = await pollHuatuoPrescription(
    options.clientId,
    options.prescriptionId,
    { mode: 'generate', onProgress: options.onProgress, isCancelled: options.isCancelled },
    options.sleep,
    options.now,
    options.fetchImpl,
  )
  if (!outcome.ok) return { ok: false, error: outcome.error, prescriptionId: options.prescriptionId }
  const { snapshot } = outcome
  if (!snapshot.content) return { ok: false, error: '处方状态对不上。请刷新再看。', prescriptionId: options.prescriptionId }
  return doneFrom(options.prescriptionId, snapshot.content, snapshot as unknown as Record<string, unknown>)
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
        effectCard: null,
      }
    },
    onError: (error) => {
      result = { ok: false, error }
    },
  })
  return result
}

function doneFrom(id: string, content: PrescriptionContent, extra: Record<string, unknown>): FollowedPrescription {
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
    effectCard: storedEffectCard(row.generation_meta) ?? null,
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
