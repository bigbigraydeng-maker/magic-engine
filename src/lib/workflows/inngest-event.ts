export interface InngestOutboundEvent<TData extends Record<string, unknown>> {
  id: string
  name: string
  data: TData
}

export interface InngestSendResult {
  event_ids: string[]
}

export async function sendInngestEvent<TData extends Record<string, unknown>>(
  event: InngestOutboundEvent<TData>,
  options: {
    eventKey?: string
    fetcher?: typeof fetch
  } = {}
): Promise<InngestSendResult> {
  const eventKey = options.eventKey ?? process.env.INNGEST_EVENT_KEY
  if (!eventKey?.trim()) throw new Error('INNGEST_EVENT_KEY_MISSING')

  const fetcher = options.fetcher ?? fetch
  const response = await fetcher(`https://inn.gs/e/${encodeURIComponent(eventKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })

  if (!response.ok) {
    // 响应体带 provider 侧的具体拒绝原因（"invalid event key" / "quota exceeded" 之类）——
    // 只留状态码 = 观测得不够，下次事故还是看不出哪一步挂。
    // 200 字够看，不至于把整条日志撑爆。
    const body = await response.text().catch(() => '')
    const tail = body ? `:${body.trim().slice(0, 200)}` : ''
    throw new Error(`INNGEST_EVENT_SEND_FAILED:${response.status}${tail}`)
  }

  const json = await response.json().catch(() => null)
  const ids = parseEventIds(json)
  if (ids.length === 0) throw new Error('INNGEST_EVENT_RECEIPT_MISSING')
  return { event_ids: ids }
}

function parseEventIds(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const record = json as Record<string, unknown>
  const ids = record.ids ?? record.event_ids
  if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (typeof record.id === 'string' && record.id.length > 0) return [record.id]
  return []
}
