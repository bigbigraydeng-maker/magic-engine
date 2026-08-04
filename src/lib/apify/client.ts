import type { ApifyRunResult, ApifyScrapingResult } from './types'

const APIFY_BASE = 'https://api.apify.com/v2'
const POLL_INTERVAL_MS = 3000

function getApifyKey(): string {
  const key = process.env.APIFY_API_KEY
  if (!key) throw new Error('APIFY_API_KEY environment variable is not set')
  return key
}

// Apify API 里 actor id 必须是 username~name 形式；调用方写的 username/name 的 `/`
// 会把 URL 路径拼断（/acts/user/name/runs → 404 page-not-found），这里统一转成 `~`。
function normalizeActorId(actorId: string): string {
  return actorId.replace('/', '~')
}

export async function runActor(
  actorId: string,
  input: Record<string, unknown>
): Promise<ApifyRunResult> {
  const token = getApifyKey()
  const res = await fetch(
    `${APIFY_BASE}/acts/${normalizeActorId(actorId)}/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Apify runActor error ${res.status}: ${err}`)
  }

  const json = await res.json() as { data: ApifyRunResult }
  return json.data
}

export async function waitForRun(
  actorId: string,
  runId: string,
  timeoutMs = 120000
): Promise<ApifyRunResult> {
  const token = getApifyKey()
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const res = await fetch(
      `${APIFY_BASE}/acts/${normalizeActorId(actorId)}/runs/${runId}?token=${token}`
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Apify waitForRun poll error ${res.status}: ${err}`)
    }

    const json = await res.json() as { data: ApifyRunResult }
    const run = json.data

    if (run.status === 'SUCCEEDED' || run.status === 'FAILED' ||
        run.status === 'TIMED-OUT' || run.status === 'ABORTED') {
      return run
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  return {
    id: runId,
    status: 'TIMED-OUT',
    defaultDatasetId: '',
    startedAt: new Date().toISOString(),
  }
}

export async function getDatasetItems<T>(datasetId: string): Promise<T[]> {
  const token = getApifyKey()
  const res = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}`
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Apify getDatasetItems error ${res.status}: ${err}`)
  }

  return res.json() as Promise<T[]>
}

export async function runActorAndGetResults<T>(
  actorId: string,
  input: Record<string, unknown>,
  timeoutMs = 120000
): Promise<ApifyScrapingResult<T>> {
  let runId: string | null = null

  try {
    const run = await runActor(actorId, input)
    runId = run.id

    const completed = await waitForRun(actorId, run.id, timeoutMs)

    if (completed.status !== 'SUCCEEDED') {
      return {
        success: false,
        data: [],
        runId,
        error: `Actor run ended with status: ${completed.status}`,
      }
    }

    const data = await getDatasetItems<T>(completed.defaultDatasetId)
    return { success: true, data, runId }
  } catch (err) {
    return {
      success: false,
      data: [],
      runId,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
