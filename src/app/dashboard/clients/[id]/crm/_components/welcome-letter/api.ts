/**
 * 「欢迎信自动发送」页面调的五个接口。只发 JSON（接口不收别的格式）；不缓存。
 */
import type { StatusPayload } from './welcome-letter-text'

export type CommandName = 'propose' | 'authorize' | 'revoke' | 'resolve-unknown'

export interface CommandAnswer {
  ok: boolean
  status: number
  body: Record<string, unknown> | null
}

function base(clientId: string): string {
  return `/api/clients/${encodeURIComponent(clientId)}/triggered-send`
}

export async function fetchStatus(clientId: string): Promise<StatusPayload> {
  const res = await fetch(`${base(clientId)}/status`, { cache: 'no-store' })
  const body = (await res.json().catch(() => null)) as StatusPayload | null
  if (body === null) return { success: false, error: 'INTERNAL_ERROR' }
  return body
}

export async function postCommand(clientId: string, name: CommandName, body: Record<string, unknown>): Promise<CommandAnswer> {
  try {
    const res = await fetch(`${base(clientId)}/${name}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, ...body }),
    })
    const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return { ok: res.ok && parsed?.success === true, status: res.status, body: parsed }
  } catch {
    return { ok: false, status: 0, body: null }
  }
}
