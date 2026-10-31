/**
 * 服务级只暂停。假依赖，不调真实广告接口，不写库。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  allowedCampaignsFromConfig,
  handlePauseOnlyRequest,
  pauseCampaignOnly,
  pauseCampaignServiceOnly,
  servicePauseEnabled,
  type PauseBody,
  type PauseOnlyDeps,
  type PauseRow,
} from '../service-pause-only'

const BODY: PauseBody = {
  client_id: '11111111-1111-1111-1111-111111111111',
  campaign_id: '333333333333',
  campaign_name: '表单系列',
  ad_account_id: 'act_444444444444',
  fault_code: 'over_daily_cap',
  fault_what: '当天花费超过日预算的 2 倍',
  spend_today_cents: 2500,
  spend_lifetime_cents: 9000,
  currency: 'NZD',
  as_of: '2026-10-27T01:00:00.000Z',
  triggered_by: 'ads-tracking-launch-watch',
  idempotency_key: 'same-key',
}

interface Calls {
  pause: string[]
  events: { id: string; data: { client_id: string; action_id: string } }[]
  inserts: Record<string, unknown>[]
}

function harness(over: Partial<PauseOnlyDeps> = {}): { deps: PauseOnlyDeps; calls: Calls; row: { current: PauseRow | null } } {
  const calls: Calls = { pause: [], events: [], inserts: [] }
  const row: { current: PauseRow | null } = { current: null }
  const deps: PauseOnlyDeps = {
    enabled: true,
    allowedCampaigns: () => [{ campaign_id: BODY.campaign_id, ad_account_id: BODY.ad_account_id }],
    findByKey: async () => row.current,
    insert: async (_clientId, payload) => {
      calls.inserts.push(payload)
      row.current = { id: 'action-1', payload }
      return { id: 'action-1' }
    },
    update: async (_id, payload) => {
      if (row.current) row.current = { id: row.current.id, payload }
      return true
    },
    resolveToken: async () => 'token-value',
    assertOwned: async () => ({ ok: true, status: 'ACTIVE' }),
    pauseOnly: async campaignId => {
      calls.pause.push(campaignId)
      return true
    },
    sendEvent: async event => {
      calls.events.push(event)
    },
    ...over,
  }
  return { deps, calls, row }
}

describe('总开关', () => {
  it('没设、或不是 1 / true，就是关', () => {
    expect(servicePauseEnabled({})).toBe(false)
    expect(servicePauseEnabled({ ME_SERVICE_PAUSE_ENABLED: '0' })).toBe(false)
    expect(servicePauseEnabled({ ME_SERVICE_PAUSE_ENABLED: 'yes' })).toBe(false)
    expect(servicePauseEnabled({ ME_SERVICE_PAUSE_ENABLED: '1' })).toBe(true)
    expect(servicePauseEnabled({ ME_SERVICE_PAUSE_ENABLED: 'true' })).toBe(true)
  })

  it('关着的时候不查记录、不改广告、不发通知', async () => {
    const { deps, calls } = harness({ enabled: false })
    const out = await pauseCampaignServiceOnly(BODY, deps)
    expect(out).toEqual({ http: 200, body: { paused: false, reason: 'switch_off' } })
    expect(calls.pause).toEqual([])
    expect(calls.events).toEqual([])
    expect(calls.inserts).toEqual([])
  })
})

describe('只暂停', () => {
  it('多出来的字段直接拒绝，包括改预算和恢复', async () => {
    const { deps, calls } = harness()
    for (const extra of [{ status: 'ACTIVE' }, { new_daily_budget: 1 }, { delete: true }]) {
      const out = await pauseCampaignServiceOnly({ ...BODY, ...extra }, deps)
      expect(out.http).toBe(422)
      expect(out.body.reason).toBe('unexpected_field')
    }
    expect(calls.pause).toEqual([])
  })

  it('包装函数只会把暂停交给广告接口', async () => {
    const setStatus = vi.fn(async () => true)
    await expect(pauseCampaignOnly('333333333333', 'token-value', setStatus)).resolves.toBe(true)
    expect(setStatus).toHaveBeenCalledTimes(1)
    expect(setStatus).toHaveBeenCalledWith('333333333333', 'token-value', 'PAUSED')
  })

  it('不属于这个客户 → 拒绝，不写记录，不改广告', async () => {
    const { deps, calls } = harness({ assertOwned: async () => ({ ok: false }) })
    const out = await pauseCampaignServiceOnly(BODY, deps)
    expect(out).toEqual({ http: 403, body: { paused: false, reason: 'not_owned' } })
    expect(calls.pause).toEqual([])
    expect(calls.inserts).toEqual([])
  })

  it('名单外系列 / 名单读不到 / 账户不符 → 拒绝，不写记录，不改广告', async () => {
    const cases: Partial<PauseOnlyDeps>[] = [
      { allowedCampaigns: () => [{ campaign_id: '999999999999', ad_account_id: BODY.ad_account_id }] },
      { allowedCampaigns: () => null },
      { allowedCampaigns: () => { throw new Error('boom') } },
      { allowedCampaigns: () => [{ campaign_id: BODY.campaign_id, ad_account_id: 'act_555555555555' }] },
    ]
    for (const over of cases) {
      const { deps, calls } = harness(over)
      const out = await pauseCampaignServiceOnly(BODY, deps)
      expect(out).toEqual({ http: 403, body: { paused: false, reason: 'not_allowlisted' } })
      expect(calls.pause).toEqual([])
      expect(calls.inserts).toEqual([])
      expect(calls.events).toEqual([])
    }
  })

  it('配置里没有的客户 → 名单为空', () => {
    expect(allowedCampaignsFromConfig(BODY.client_id)).toBeNull()
  })

  it('记录写不进去就不改广告', async () => {
    const { deps, calls } = harness({ insert: async () => null })
    const out = await pauseCampaignServiceOnly(BODY, deps)
    expect(out.body).toMatchObject({ paused: false, reason: 'log_failed' })
    expect(calls.pause).toEqual([])
    expect(calls.events).toEqual([])
  })

  it('别人已经暂停 → 只记一笔，不再改，也不发通知', async () => {
    const { deps, calls } = harness({ assertOwned: async () => ({ ok: true, status: 'PAUSED' }) })
    const out = await pauseCampaignServiceOnly(BODY, deps)
    expect(out.body).toMatchObject({ paused: false, reason: 'already_paused' })
    expect(calls.pause).toEqual([])
    expect(calls.events).toEqual([])
    expect(calls.inserts[0]).toMatchObject({ status: 'already_paused' })
  })

  it('新暂停成功才发一次通知；同一把钥匙再来不改第二次、也不再发', async () => {
    const { deps, calls } = harness()
    const first = await pauseCampaignServiceOnly(BODY, deps)
    expect(first.body).toMatchObject({ paused: true, reason: 'paused', action_id: 'action-1' })
    expect(calls.pause).toEqual(['333333333333'])
    expect(calls.events).toEqual([{ id: 'same-key', data: { client_id: BODY.client_id, action_id: 'action-1' } }])
    const second = await pauseCampaignServiceOnly(BODY, deps)
    expect(second.body).toMatchObject({ paused: true, reason: 'paused', idempotent: true })
    expect(calls.pause).toHaveLength(1)
    expect(calls.events).toHaveLength(1)
  })

  it('广告接口没停成 → 不发通知', async () => {
    const { deps, calls } = harness({ pauseOnly: async () => false })
    const out = await pauseCampaignServiceOnly(BODY, deps)
    expect(out.body).toMatchObject({ paused: false, reason: 'meta_failed' })
    expect(calls.events).toEqual([])
  })
})

describe('入口鉴权', () => {
  it('没配密钥是 503，密钥不对是 401，不认别的登录信息', async () => {
    const { deps, calls } = harness()
    const missing = await handlePauseOnlyRequest(new Request('https://app.example.test/pause', { method: 'POST', body: '{}' }), deps, undefined)
    expect(missing.status).toBe(503)
    const wrong = await handlePauseOnlyRequest(new Request('https://app.example.test/pause', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', cookie: 'session=abc' },
      body: JSON.stringify(BODY),
    }), deps, 'expected-secret')
    expect(wrong.status).toBe(401)
    expect(calls.pause).toEqual([])
  })
})
