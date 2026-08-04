// Muapi 客户端 — 提交异步生成任务 + 轮询结果。
// Muapi 是项目认可的 AI 媒体引擎（配音/克隆/i2v/数字人，见 memory: disable-higgsfield-use-muapi）。
// 协议：POST /api/v1/<model> → { request_id }，轮询 GET /api/v1/predictions/<id>/result（status=completed 取 outputs）。
// 鉴权：请求头 x-api-key。服务端使用（ME on Render）。

const MUAPI_BASE = 'https://api.muapi.ai/api/v1'
const POLL_INTERVAL_MS = 4000
const REQUEST_TIMEOUT_MS = 30000       // 单次 HTTP 超时——防连接挂起绕过整体 deadline
const MAX_TRANSIENT_POLL_ERRORS = 4    // 轮询容忍的连续瞬时错误数（429/5xx/网络抖动）

function getMuapiKey(): string {
  const key = process.env.MUAPI_API_KEY
  if (!key) throw new Error('MUAPI_API_KEY environment variable is not set')
  return key
}

export interface MuapiResult {
  status: 'completed' | 'failed' | 'cancelled' | string
  outputs: string[]     // 产物 URL 列表（图/视频/音频，视模型而定）
  error?: string
  costUsd?: number
}

/** 提交一个 Muapi 任务，返回 request_id。 */
export async function submitMuapi(
  model: string,
  input: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${MUAPI_BASE}/${model}`, {
    method: 'POST',
    headers: { 'x-api-key': getMuapiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`Muapi submit ${model} error ${res.status}: ${await res.text()}`)
  }
  const json = (await res.json()) as { request_id?: string }
  if (!json.request_id) {
    throw new Error(`Muapi ${model} returned no request_id: ${JSON.stringify(json)}`)
  }
  return json.request_id
}

/** 轮询任务结果直到 completed/failed 或超时。 */
export async function pollMuapiResult(
  requestId: string,
  timeoutMs = 300000,
): Promise<MuapiResult> {
  const deadline = Date.now() + timeoutMs
  let transientErrors = 0
  while (Date.now() < deadline) {
    let d: { status?: string; outputs?: unknown; error?: string; cost?: { amount_usd?: number } }
    try {
      const res = await fetch(`${MUAPI_BASE}/predictions/${requestId}/result`, {
        headers: { 'x-api-key': getMuapiKey() },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      // 429/5xx/网络抖动是瞬时的：任务在 Muapi 侧可能还在跑，别一次抖动就判死整单
      // （否则上层若"重试=再 submit"会二次扣费）。连续多次才放弃。
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Muapi poll transient ${res.status}`)
      }
      if (!res.ok) {
        throw new Error(`Muapi poll error ${res.status}: ${await res.text()}`)
      }
      d = (await res.json()) as typeof d
      transientErrors = 0
    } catch (e) {
      const status = (e as { name?: string })?.name
      const msg = e instanceof Error ? e.message : String(e)
      // 明确的非瞬时错误（非 429/5xx、非超时/网络）直接抛
      if (!/transient|timeout|abort|network|fetch failed|ECONN|ETIMEDOUT/i.test(`${status} ${msg}`)) {
        throw e
      }
      if (++transientErrors > MAX_TRANSIENT_POLL_ERRORS) {
        throw new Error(`Muapi poll gave up after ${transientErrors} transient errors (job ${requestId} may still be running; do NOT blindly re-submit): ${msg}`)
      }
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    const status = d.status ?? 'processing'
    const costUsd = d.cost?.amount_usd
    if (status === 'completed') {
      const outputs = Array.isArray(d.outputs)
        ? d.outputs.filter((o): o is string => typeof o === 'string')
        : []
      return { status, outputs, costUsd }
    }
    if (status === 'failed' || status === 'cancelled') {
      return { status, outputs: [], error: d.error || `Muapi job ${status}`, costUsd }
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Muapi job ${requestId} timed out after ${timeoutMs}ms`)
}

/** 提交 + 轮询的便捷封装。 */
export async function runMuapi(
  model: string,
  input: Record<string, unknown>,
  timeoutMs?: number,
): Promise<MuapiResult> {
  const requestId = await submitMuapi(model, input)
  return pollMuapiResult(requestId, timeoutMs)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
