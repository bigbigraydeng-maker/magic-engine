/**
 * 盯盘命中故障后，用服务密钥去调「只暂停」入口。
 * 入口本身在另一处实现（POST /api/internal/meta-ads/pause-only）。
 * 这里不直接改广告：入口没开、没部署、或密钥没配，都只记原因。
 */

import type { PauseRequestReceipt, ServicePauseCall } from './lead-form-types'

export const SERVICE_PAUSE_PATH = '/api/internal/meta-ads/pause-only'

export interface ServicePauseClientInput {
  call: ServicePauseCall
  fetchImpl: typeof fetch
  appBase: string
  /** 现有的服务密钥。没配就不发请求。 */
  serviceKey: string | null
}

function receipt(called: boolean, paused: boolean, reason: string, idempotent = false): PauseRequestReceipt {
  return { called, paused, reason, idempotent }
}

function reasonOf(body: unknown, status: number): PauseRequestReceipt {
  if (typeof body !== 'object' || body === null) return receipt(true, false, `http_${status}`)
  const row = body as Record<string, unknown>
  const paused = row.paused === true
  const reason = typeof row.reason === 'string' && row.reason.length > 0 ? row.reason : paused ? 'paused' : `http_${status}`
  const idempotent = row.idempotent === true
  if (status < 200 || status >= 300) return receipt(true, false, reason, idempotent)
  return receipt(true, paused, reason, idempotent)
}

/** 永不抛错。密钥不进网址。 */
export async function requestServicePause(input: ServicePauseClientInput): Promise<PauseRequestReceipt> {
  if (input.serviceKey === null || input.serviceKey.length === 0) {
    return receipt(false, false, 'service_key_missing')
  }
  const url = `${input.appBase.replace(/\/$/, '')}${SERVICE_PAUSE_PATH}`
  try {
    const res = await input.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.serviceKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(input.call),
    })
    const body: unknown = await res.json().catch(() => null)
    return reasonOf(body, res.status)
  } catch {
    return receipt(true, false, 'pause_unavailable')
  }
}
