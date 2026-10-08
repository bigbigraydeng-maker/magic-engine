import { GRAPH_BASE } from '@/lib/meta/graph-base'
import type { GraphGetResult, PostResolverDeps } from './post-resolver'

export type FetchLike = (
  url: string,
  init?: { method?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

export const GRAPH_READ_TIMEOUT_MS = 15_000

const NETWORK_ERROR_MESSAGE = '读取 Meta 失败（网络或超时）'
const PROBE_NETWORK_ERROR_MESSAGE = '探测令牌失败（网络或超时）'
const PROBE_BAD_RESPONSE_MESSAGE = '探测令牌失败（Meta 返回异常）'
const PROBE_INVALID_TOKEN_MESSAGE = '令牌已失效'
const PROBE_MISSING_SCOPE_MESSAGE = '令牌缺少 ads_management 权限'
const PROBE_EXPIRED_TOKEN_MESSAGE = '令牌已过期'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonBody(text: string): Promise<unknown> {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export function createGraphGet(
  fetchImpl: FetchLike,
  accessToken: string,
): PostResolverDeps['graphGet'] {
  return async (path: string, query: Record<string, string>): Promise<GraphGetResult> => {
    const params = new URLSearchParams({ ...query, access_token: accessToken })
    const url = `${GRAPH_BASE}${path}?${params.toString()}`

    let response: { ok: boolean; status: number; text: () => Promise<string> }
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        signal: AbortSignal.timeout(GRAPH_READ_TIMEOUT_MS),
      })
    } catch {
      throw new Error(NETWORK_ERROR_MESSAGE)
    }

    const text = await response.text()
    const body = await readJsonBody(text)

    return { ok: response.ok, status: response.status, body }
  }
}

export async function probeMetaToken(
  fetchImpl: FetchLike,
  token: string,
): Promise<{ ok: boolean; detail?: string }> {
  const params = new URLSearchParams({ input_token: token, access_token: token })
  const url = `${GRAPH_BASE}/debug_token?${params.toString()}`

  let response: { ok: boolean; status: number; text: () => Promise<string> }
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(GRAPH_READ_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, detail: PROBE_NETWORK_ERROR_MESSAGE }
  }

  if (!response.ok) {
    return { ok: false, detail: PROBE_BAD_RESPONSE_MESSAGE }
  }

  const text = await response.text()
  const body = await readJsonBody(text)

  if (!isRecord(body)) {
    return { ok: false, detail: PROBE_BAD_RESPONSE_MESSAGE }
  }

  const data = body.data
  if (!isRecord(data)) {
    return { ok: false, detail: PROBE_BAD_RESPONSE_MESSAGE }
  }

  if (data.is_valid !== true) {
    return { ok: false, detail: PROBE_INVALID_TOKEN_MESSAGE }
  }

  const scopes = data.scopes
  if (!Array.isArray(scopes) || !scopes.includes('ads_management')) {
    return { ok: false, detail: PROBE_MISSING_SCOPE_MESSAGE }
  }

  const expiresAt = data.expires_at
  if (typeof expiresAt === 'number' && expiresAt > 0 && expiresAt * 1000 < Date.now()) {
    return { ok: false, detail: PROBE_EXPIRED_TOKEN_MESSAGE }
  }

  return { ok: true }
}
