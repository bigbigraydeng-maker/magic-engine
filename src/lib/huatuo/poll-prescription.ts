/**
 * 轮询一份已经在后台开方的处方，直到它离开「生成中」。
 *
 * 页面不再拿着一条 HTTP 连接干等模型。正式域名走 Cloudflare，一条请求
 * 大约 100 秒没有响应就会被掐成网关错误页。开方本身大约要 2 分钟，
 * 所以这里改成短请求反复读处方行（status / progress_note / content）。
 */

import type { Prescription, PrescriptionContent } from '@/types/diagnostic'
import type { HuatuoGenerationMeta, SelfGrade, TrendSummaryLite } from './types'

export const POLL_INTERVAL_MS = 2_000
export const POLL_MAX_MS = 8 * 60 * 1000
export const POLL_MAX_CONSECUTIVE_FAILURES = 5

export const POLL_TIMEOUT_MESSAGE =
  '开方时间比平时长，页面先不等了。请过一会儿刷新，写好的处方会在草稿里。'

export const POLL_UNSTABLE_MESSAGE =
  '网络不稳定，暂时查不到进度。请刷新页面，写好的处方通常在草稿里。'

export type PrescriptionPollMode = 'generate' | 'refine'

export interface PrescriptionPollSnapshot {
  status: string
  progress_note: string | null
  error_message: string | null
  content: PrescriptionContent | null
  self_grade: SelfGrade | null
  generation_meta: (HuatuoGenerationMeta & { trend_summary?: TrendSummaryLite | null }) | null
  agent_name: string | null
}

export type PrescriptionPollOutcome =
  | { ok: true; snapshot: PrescriptionPollSnapshot }
  | { ok: false; error: string }

type InterpretResult = 'wait' | PrescriptionPollOutcome

export function interpretPrescriptionPoll(
  snapshot: PrescriptionPollSnapshot,
  mode: PrescriptionPollMode,
): InterpretResult {
  if (snapshot.status === 'generating') return 'wait'
  if (snapshot.status === 'failed') {
    return { ok: false, error: snapshot.error_message || '开方失败' }
  }
  const settled = snapshot.status === 'draft' || snapshot.status === 'approved'
  if (!settled) return { ok: false, error: '处方状态异常，请刷新页面再看' }
  if (mode === 'refine' && snapshot.error_message) {
    return { ok: false, error: snapshot.error_message }
  }
  if (!snapshot.content) return 'wait'
  return { ok: true, snapshot }
}

interface PollHandlers {
  mode: PrescriptionPollMode
  onProgress?: (note: string | null) => void
  isCancelled?: () => boolean
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function pollHuatuoPrescription(
  clientId: string,
  prescriptionId: string,
  handlers: PollHandlers,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => number = () => Date.now(),
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<PrescriptionPollOutcome> {
  const startedAt = now()
  let consecutiveFailures = 0

  for (;;) {
    if (handlers.isCancelled?.()) return { ok: false, error: '' }

    try {
      const snapshot = await readSnapshot(clientId, prescriptionId, fetchImpl)
      consecutiveFailures = 0
      if (handlers.isCancelled?.()) return { ok: false, error: '' }
      handlers.onProgress?.(snapshot.progress_note)
      const interpreted = interpretPrescriptionPoll(snapshot, handlers.mode)
      if (interpreted !== 'wait') return interpreted
    } catch {
      if (handlers.isCancelled?.()) return { ok: false, error: '' }
      consecutiveFailures += 1
      if (consecutiveFailures >= POLL_MAX_CONSECUTIVE_FAILURES) {
        return { ok: false, error: POLL_UNSTABLE_MESSAGE }
      }
    }

    if (now() - startedAt > POLL_MAX_MS) return { ok: false, error: POLL_TIMEOUT_MESSAGE }
    await sleep(POLL_INTERVAL_MS)
  }
}

async function readSnapshot(
  clientId: string,
  prescriptionId: string,
  fetchImpl: FetchLike,
): Promise<PrescriptionPollSnapshot> {
  const res = await fetchImpl(`/api/clients/${clientId}/prescription/${prescriptionId}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`transient ${res.status}`)
  const data = await res.json() as { prescription?: Prescription }
  if (!data.prescription) throw new Error('missing prescription')
  return toSnapshot(data.prescription)
}

function toSnapshot(row: Prescription): PrescriptionPollSnapshot {
  const extra = row as Prescription & {
    self_grade?: SelfGrade | null
    generation_meta?: PrescriptionPollSnapshot['generation_meta']
  }
  return {
    status: row.status,
    progress_note: row.progress_note,
    error_message: row.error_message,
    content: row.content,
    self_grade: extra.self_grade ?? null,
    generation_meta: extra.generation_meta ?? null,
    agent_name: row.agent_name ?? null,
  }
}
