import { fieldAgentWriteTargets, type FieldAgentWebhookBody } from './contracts'

const DEFAULT_HEADER = 'Authorization'
const TIMEOUT_MS = 15_000

export type FieldAgentWebhookConfig = { url: string; headerName: string; headerValue: string }

type FieldAgentEnv = {
  FIELD_AGENT_WEBHOOK_URL?: string
  FIELD_AGENT_WEBHOOK_KEY?: string
  FIELD_AGENT_WEBHOOK_HEADER?: string
}

export function resolveFieldAgentWebhook(env: NodeJS.ProcessEnv | FieldAgentEnv = process.env): FieldAgentWebhookConfig | null {
  const url = env.FIELD_AGENT_WEBHOOK_URL?.trim() ?? ''
  const key = env.FIELD_AGENT_WEBHOOK_KEY?.trim() ?? ''
  const headerName = env.FIELD_AGENT_WEBHOOK_HEADER?.trim() || DEFAULT_HEADER
  if (!url || !key || !/^https:\/\//.test(url)) return null
  if (!/^[A-Za-z0-9-]{1,40}$/.test(headerName)) return null
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) return null
  } catch {
    return null
  }
  const headerValue = headerName.toLowerCase() === 'authorization' && !key.toLowerCase().startsWith('bearer ')
    ? `Bearer ${key}`
    : key
  return { url, headerName, headerValue }
}

export function missingWebhookMessage(): string {
  return '外勤采集还没接上：服务器还没配置采集助手的地址或钥匙，这次没有建立任务。'
}

export async function postFieldAgentWebhook(
  config: FieldAgentWebhookConfig,
  body: FieldAgentWebhookBody,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'content-type': 'application/json', [config.headerName]: config.headerValue },
      body: JSON.stringify({ ...body, write_targets: fieldAgentWriteTargets }),
    })
    if (!response.ok) return { ok: false, message: `webhook_http_${response.status}` }
    return { ok: true }
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error'
    return { ok: false, message: name === 'TimeoutError' ? 'webhook_timeout' : 'webhook_unreachable' }
  }
}
