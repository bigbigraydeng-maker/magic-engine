// Muapi 客户端 — 提交异步生成任务 + 轮询结果。
// Muapi 是项目认可的 AI 媒体引擎（配音/克隆/i2v/数字人，见 memory: disable-higgsfield-use-muapi）。
// 协议：POST /api/v1/<model> → { request_id }，轮询 GET /api/v1/predictions/<id>/result（status=completed 取 outputs）。
// 鉴权：请求头 x-api-key。服务端使用（ME on Render）。

const MUAPI_BASE = 'https://api.muapi.ai/api/v1'
const POLL_INTERVAL_MS = 4000

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
  while (Date.now() < deadline) {
    const res = await fetch(`${MUAPI_BASE}/predictions/${requestId}/result`, {
      headers: { 'x-api-key': getMuapiKey() },
    })
    if (!res.ok) {
      throw new Error(`Muapi poll error ${res.status}: ${await res.text()}`)
    }
    const d = (await res.json()) as {
      status?: string
      outputs?: unknown
      error?: string
      cost?: { amount_usd?: number }
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
