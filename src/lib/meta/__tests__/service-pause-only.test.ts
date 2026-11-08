/**
 * 服务级只暂停。假依赖，不调真实广告接口，不写库。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { assertMayClick } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import {
  allowedCampaignsFromConfig,
  handlePauseOnlyRequest,
  pauseCampaignServiceOnly,
  servicePauseClicker,
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
  cards: string[]
  inserts: Record<string, unknown>[]
}

function harness(over: Partial<PauseOnlyDeps> = {}): { deps: PauseOnlyDeps; calls: Calls; row: { current: PauseRow | null } } {
  const calls: Calls = { cards: [], inserts: [] }
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
    issuePauseCard: async () => {
      calls.cards.push(BODY.campaign_id)
      return { ok: true, runId: 'run-1' }
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
    expect(calls.cards).toEqual([])
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
    expect(calls.cards).toEqual([])
  })

  it('不属于这个客户 → 拒绝，不写记录，不改广告', async () => {
    const { deps, calls } = harness({ assertOwned: async () => ({ ok: false }) })
    const out = await pauseCampaignServiceOnly(BODY, deps)
    expect(out).toEqual({ http: 403, body: { paused: false, reason: 'not_owned' } })
    expect(calls.cards).toEqual([])
    expect(calls.inserts).toEqual([])
  })

  it('名单外系列 / 名单读不到 / 账户不符 → 拒绝，不写记录，不出卡', async () => {
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
      expect(calls.cards).toEqual([])
      expect(calls.inserts).toEqual([])
    }
  })

  it('配置里没有的客户 → 名单为空', () => {
    expect(allowedCampaignsFromConfig(BODY.client_id)).toBeNull()
  })

  it('记录写不进去就不出卡', async () => {
    const { deps, calls } = harness({ insert: async () => null })
    const out = await pauseCampaignServiceOnly(BODY, deps)
    expect(out.body).toMatchObject({ paused: false, reason: 'log_failed' })
    expect(calls.cards).toEqual([])
  })

  it('别人已经暂停 → 只记一笔，不出卡', async () => {
    const { deps, calls } = harness({ assertOwned: async () => ({ ok: true, status: 'PAUSED' }) })
    const out = await pauseCampaignServiceOnly(BODY, deps)
    expect(out.body).toMatchObject({ paused: false, reason: 'already_paused' })
    expect(calls.cards).toEqual([])
    expect(calls.inserts[0]).toMatchObject({ status: 'already_paused' })
  })

  it('在投时只出卡，广告没有停；同一把钥匙不再出第二张', async () => {
    const { deps, calls } = harness()
    const first = await pauseCampaignServiceOnly(BODY, deps)
    expect(first.body).toMatchObject({ paused: false, reason: 'card_issued', action_id: 'action-1', card_run_id: 'run-1' })
    expect(first.http).toBe(202)
    expect(calls.cards).toEqual([BODY.campaign_id])
    const second = await pauseCampaignServiceOnly(BODY, deps)
    expect(second.body).toMatchObject({ paused: false, reason: 'card_issued', idempotent: true })
    expect(calls.cards).toHaveLength(1)
  })

  it('出卡失败也不暂停', async () => {
    const { deps, calls } = harness({ issuePauseCard: async () => ({ ok: false, reason: 'card_failed' }) })
    const out = await pauseCampaignServiceOnly(BODY, deps)
    expect(out.body).toMatchObject({ paused: false, reason: 'card_failed' })
    expect(calls.cards).toEqual([])
  })

  it('没卡、过期或未确认都不能从服务入口写成已暂停', () => {
    const source = readFileSync('src/lib/meta/service-pause-only.ts', 'utf8')
    expect(source).not.toContain('setCampaignStatus')
    expect(source).not.toContain('confirmCampaignStatusCard')
    const clicker = servicePauseClicker(BODY.client_id)
    expect(clicker.kind).toBe('agent')
    expect(() => assertMayClick(clicker, BODY.client_id)).toThrow(ConfirmationCardError)
  })

  it('把确认塞进服务请求里会被拒绝，不出卡', async () => {
    const { deps, calls } = harness()
    const out = await pauseCampaignServiceOnly({ ...BODY, resolution: 'confirm' }, deps)
    expect(out.http).toBe(422)
    expect(calls.cards).toEqual([])
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
    expect(calls.cards).toEqual([])
  })
})
