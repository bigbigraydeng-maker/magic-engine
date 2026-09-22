/** Shared GET-only Meta transport. Never follows provider URLs or logs provider bodies. */
export class MetaReadError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code) }
}
export function metaReadVersion(): string {
  const version = process.env.META_ADS_AI_GRAPH_VERSION
  if (!version || !/^v\d+\.0$/.test(version)) throw new MetaReadError('configuration_required', 503)
  return version
}
export async function metaGraphGet(
  path: string, token: string, params: Record<string, string>, deadline = Date.now() + 20_000,
): Promise<Record<string, unknown>> {
  if (!/^(me(?:\/(adaccounts|permissions))?|act_[1-9]\d{9,24}(?:\/(campaigns|adsets|ads|insights))?)$/.test(path)) {
    throw new MetaReadError('invalid_resource')
  }
  if (deadline <= Date.now()) throw new MetaReadError('provider_timeout', 504)
  const url = new URL(`https://graph.facebook.com/${metaReadVersion()}/${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(Math.min(15_000, deadline - Date.now())) })
    const body: unknown = await res.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MetaReadError('provider_invalid_response', 502)
    const record = body as Record<string, unknown>
    if (!res.ok || record.error) {
      const code = (record.error as { code?: number } | undefined)?.code
      if(res.status === 429 || [4,17,32,613].includes(code ?? 0)) throw new MetaReadError('provider_rate_limited',429)
      throw new MetaReadError(code === 190 ? 'reconnect_required' : code === 10 || code === 200 ? 'permission_required' : 'provider_query_failed', 502)
    }
    return record
  } catch (error) {
    if (error instanceof MetaReadError) throw error
    throw new MetaReadError('provider_unavailable', 502)
  }
}
export function graphRows(body: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(body.data) || body.data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new MetaReadError('provider_invalid_response', 502)
  }
  return body.data as Record<string, unknown>[]
}
export function graphAfter(body: Record<string, unknown>): string | null {
  const paging = body.paging as { next?: unknown; cursors?: { after?: unknown } } | undefined
  if (!paging?.next) return null
  if (typeof paging.cursors?.after !== 'string' || paging.cursors.after.length > 4096) throw new MetaReadError('provider_invalid_cursor', 502)
  return paging.cursors.after
}
