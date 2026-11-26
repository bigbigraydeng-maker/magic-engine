/**
 * 写之前先读：这个系列或广告组是不是这张卡上的广告账户的。
 * 读不到、对不上，就不写。不把令牌或返回正文放进错误信息。
 */

import { GRAPH_BASE } from './graph-base'

const READ_TIMEOUT_MS = 15_000
const OBJECT_ID = /^\d{5,20}$/
const ACCOUNT_ID = /^\d{1,20}$/

export function isMetaObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID.test(value)
}

export function adAccountMatches(adAccountId: string, accountId: string): boolean {
  const bare = adAccountId.startsWith('act_') ? adAccountId.slice(4) : adAccountId
  return ACCOUNT_ID.test(bare) && bare === accountId
}

function accountIdOf(body: Record<string, unknown>): string | null {
  const raw = body.account_id
  if (typeof raw === 'string' && ACCOUNT_ID.test(raw)) return raw
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) return String(raw)
  return null
}

export async function assertOwnedByAccount(
  objectId: string,
  adAccountId: string,
  accessToken: string,
  fields: string,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  if (!isMetaObjectId(objectId)) return { ok: false, error: '编号格式不对，没有去建。' }
  const params = new URLSearchParams({ fields, access_token: accessToken })
  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${objectId}?${params}`, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
  } catch {
    return { ok: false, error: '读不到这个广告对象，没有去建。' }
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) return { ok: false, error: `读这个广告对象失败（HTTP ${res.status}），没有去建。` }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: '读回的内容看不懂，没有去建。' }
  }
  if (!json || typeof json !== 'object') return { ok: false, error: '读回的内容看不懂，没有去建。' }
  const body = json as Record<string, unknown>
  const accountId = accountIdOf(body)
  if (!accountId || !adAccountMatches(adAccountId, accountId)) {
    return { ok: false, error: '这个广告对象不属于这张卡上的广告账户，没有去建。' }
  }
  if (body.id !== objectId) return { ok: false, error: '读回的编号对不上，没有去建。' }
  return { ok: true, body }
}
