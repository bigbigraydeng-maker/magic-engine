import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { rpc: rpcMock },
}))

import { ENGINE_CATALOG_ID, REQUIRED_ENGINE_CAPABILITIES } from '@/lib/factory/engine-catalog.mjs'
import { POST } from './route'

const CURRENT_ENGINE = {
  engine_rev: 'a'.repeat(40),
  catalog_id: ENGINE_CATALOG_ID,
  capabilities: [...REQUIRED_ENGINE_CAPABILITIES],
}

const CLIENT_A = '10000000-0000-0000-0000-000000000001'
const CLIENT_B = '20000000-0000-0000-0000-000000000002'
const UNKNOWN = '30000000-0000-0000-0000-000000000003'

function claimRequest(body: unknown) {
  const payload = body && typeof body === 'object' && !Array.isArray(body)
    ? { engine: CURRENT_ENGINE, ...(body as Record<string, unknown>) }
    : body
  return new NextRequest('http://localhost/api/factory/worker/claim', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-worker-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

describe('POST /api/factory/worker/claim client scope', () => {
  const oldToken = process.env.FACTORY_WORKER_TOKEN
  const oldClients = process.env.FACTORY_WORKER_CLIENT_IDS

  beforeEach(() => {
    process.env.FACTORY_WORKER_TOKEN = 'test-worker-token'
    process.env.FACTORY_WORKER_CLIENT_IDS = `${CLIENT_A},${CLIENT_B}`
    rpcMock.mockReset().mockResolvedValue({ data: [{ ok: false }], error: null })
  })

  afterEach(() => {
    if (oldToken === undefined) delete process.env.FACTORY_WORKER_TOKEN
    else process.env.FACTORY_WORKER_TOKEN = oldToken
    if (oldClients === undefined) delete process.env.FACTORY_WORKER_CLIENT_IDS
    else process.env.FACTORY_WORKER_CLIENT_IDS = oldClients
  })

  it('白名单内目标 → RPC 只收到该客户', async () => {
    const response = await POST(claimRequest({ worker_id: 'mac-a', client_id: CLIENT_A }))

    expect(response.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('factory_claim_work_order', {
      p_worker_id: 'mac-a',
      p_client_ids: [CLIENT_A],
    })
  })

  it('白名单外目标 → 403 且不调用 claim RPC', async () => {
    const response = await POST(claimRequest({ worker_id: 'mac-unknown', client_id: UNKNOWN }))

    expect(response.status).toBe(403)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('未指定目标 → 保留现有全白名单 claim 行为', async () => {
    const response = await POST(claimRequest({ worker_id: 'mac-shared' }))

    expect(response.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('factory_claim_work_order', {
      p_worker_id: 'mac-shared',
      p_client_ids: [CLIENT_A, CLIENT_B],
    })
  })

  it.each([null, [], 'bad', 42])('畸形 body %j → 400 且不调用 claim RPC', async (body) => {
    const response = await POST(claimRequest(body))

    expect(response.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('RPC 返回目标外客户 → 500 且不进入签名 URL 生成', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ ok: true, work_order_id: UNKNOWN, client_id: CLIENT_B, brief: {}, budget_cap_usd: 2 }],
      error: null,
    })

    const response = await POST(claimRequest({ worker_id: 'mac-a', client_id: CLIENT_A }))

    expect(response.status).toBe(500)
  })

  it('旧出片机不派单，工单留在队列，并告诉人怎么更新', async () => {
    const response = await POST(claimRequest({ worker_id: 'mac-old', client_id: CLIENT_A, engine: null }))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.claimed).toBe(false)
    expect(json.stale_engine).toBe(true)
    expect(json.message).toContain('出片机版本过旧')
    expect(json.message).toContain('不会作废')
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
