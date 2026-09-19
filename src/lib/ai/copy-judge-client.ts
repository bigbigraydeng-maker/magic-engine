/**
 * Copy Judge — L3 connector for a fast yes/no copy-judgement model.
 *
 * Packaged name: "Copy Judge". Provider (internal only, never in UI/reports):
 * TypeSafe `systemone` endpoint, model `jev-latest`, auth via TYPESAFE_API_KEY.
 *
 * Provider-specific request/response shape stays inside this file. Callers ask
 * `noul` questions (probability 0–1 that a statement is true) and get back a
 * plain `Record<questionId, number>`. Any transport / auth / shape problem
 * throws `CopyJudgeError` — callers decide how to fail (content guard fails
 * closed: error ⇒ needs human review).
 *
 * Per CLAUDE.md: env + fetch are resolved inside the call, never at module top.
 */

const COPY_JUDGE_URL = 'https://api.typesafe.ai/v1/systemone'
const COPY_JUDGE_MODEL = 'jev-latest'
const DEFAULT_TIMEOUT_MS = 8000

export class CopyJudgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CopyJudgeError'
  }
}

export interface CopyJudgeQuestion {
  /** Statement the model scores as "probability this is true" (0–1). */
  instructions: string
}

export interface CopyJudgeOptions {
  timeoutMs?: number
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

type ProviderAnswers = Record<string, { noul?: unknown } | undefined>

/**
 * Ask the Copy Judge one or more `noul` questions about a piece of state.
 * Returns question id → probability (0–1). Throws CopyJudgeError on any failure,
 * including a missing answer for any asked question.
 */
export async function askCopyJudge(
  state: Record<string, unknown>,
  questions: Record<string, CopyJudgeQuestion>,
  options: CopyJudgeOptions = {},
): Promise<Record<string, number>> {
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) throw new CopyJudgeError('Copy Judge not configured (TYPESAFE_API_KEY missing)')

  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const providerQuestions = Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [id, { type: 'noul', instructions: q.instructions }]),
  )

  let body: unknown
  try {
    const res = await fetchImpl(COPY_JUDGE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, model: COPY_JUDGE_MODEL, questions: providerQuestions }),
      signal: controller.signal,
    })
    if (!res.ok) throw new CopyJudgeError(`Copy Judge HTTP ${res.status}`)
    body = await res.json()
  } catch (err) {
    if (err instanceof CopyJudgeError) throw err
    throw new CopyJudgeError(`Copy Judge request failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }

  const answers = (body as { answers?: ProviderAnswers } | null)?.answers
  const out: Record<string, number> = {}
  for (const id of Object.keys(questions)) {
    const p = answers?.[id]?.noul
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
      throw new CopyJudgeError(`Copy Judge returned no valid answer for "${id}"`)
    }
    out[id] = p
  }
  return out
}
