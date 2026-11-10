/**
 * 线索阶段事件（Meta Conversion Leads）的组装与发送目标（2026-11-10）。
 * 全部离线：fetcher 是假函数。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config', () => ({
  resolveCapiConfig: vi.fn(),
  CapiConfigError: class extends Error {},
}))

import { MetaCapiWriter } from '../writer'
import { resolveCapiConfig } from '../config'
import type { ClientSendConfig, OutcomeForSend } from '@/lib/conversions/destination-writer'

const writer = new MetaCapiWriter()
const WEB_PIXEL = '1824094338280968'
const CRM_DATASET = '998877665544332'
const LEAD_ID = '1189338710082692'

const BASE: ClientSendConfig = { clientId: 'c0000000-0000-0000-0000-000000000000', defaultPhoneCountry: '64', facebookPageId: null }
const WITH_CRM: ClientSendConfig = { ...BASE, crmStage: { datasetId: CRM_DATASET, leadEventSource: 'Magic Engine' } }

function stage(over: Partial<OutcomeForSend> = {}): OutcomeForSend {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    clientId: BASE.clientId,
    contactId: 'contact-1',
    outcomeKind: 'lead_stage',
    leadStage: 'Quoted',
    customerEmail: 'rosalind@example.com',
    customerPhone: '6421555123',
    customerFirst: null,
    customerLast: null,
    orderRef: null,
    amountMinor: null,
    currency: null,
    occurredAt: '2026-11-08T03:00:00.000Z',
    pageScopedUserId: null,
    metaLeadId: LEAD_ID,
    actionSource: 'system_generated',
    ...over,
  }
}

/** 假请求：签名与真 fetch 一致，按网址返回预设响应，并记下每次请求的网址。 */
function fakeFetch(respond: (url: string) => Response) {
  const urls: string[] = []
  const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    urls.push(url)
    return respond(url)
  })
  return { fetcher, urls }
}

const ok = () => new Response('{"events_received":1}', { status: 200 })

beforeEach(() => {
  vi.mocked(resolveCapiConfig).mockResolvedValue({
    clientId: BASE.clientId,
    pixelId: WEB_PIXEL,
    accessToken: 'tok',
    source: { tokenEnv: 'X', pixelEnv: 'Y' },
  })
})

describe('组装', () => {
  it('按 Meta 线索阶段规范组装：system_generated + crm + 阶段名 + 线索编号（字符串、不哈希）', () => {
    const ev = writer.build(stage(), WITH_CRM).data[0]
    expect(ev.event_name).toBe('Quoted')
    expect(ev.action_source).toBe('system_generated')
    expect(ev.custom_data).toEqual({ event_source: 'crm', lead_event_source: 'Magic Engine' })
    expect(ev.user_data.lead_id).toBe(LEAD_ID)
    expect(typeof ev.user_data.lead_id).toBe('string')
    // 邮箱电话照常哈希，不出现明文
    expect(JSON.stringify(ev)).not.toContain('rosalind@example.com')
    expect(ev.user_data.em).toHaveLength(1)
  })

  it('不带金额：阶段不是成交', () => {
    const ev = writer.build(stage({ amountMinor: 50000, currency: 'NZD' }), WITH_CRM).data[0]
    expect(ev.custom_data).not.toHaveProperty('value')
    expect(ev.custom_data).not.toHaveProperty('currency')
  })

  it('没有线索编号 → 组装失败，不发', () => {
    expect(() => writer.build(stage({ metaLeadId: null }), WITH_CRM)).toThrow(/线索编号/)
    expect(() => writer.build(stage({ metaLeadId: '123' }), WITH_CRM)).toThrow(/线索编号/)
  })

  it('没配线索阶段数据集 → 组装失败，不回落到网站数据集', () => {
    expect(() => writer.build(stage(), BASE)).toThrow(/线索阶段数据集/)
  })

  it('普通成交照旧：不受影响', () => {
    const ev = writer.build(
      stage({ outcomeKind: 'purchase', leadStage: null, amountMinor: 50000, currency: 'NZD', actionSource: 'email' }),
      WITH_CRM,
    ).data[0]
    expect(ev.event_name).toBe('Purchase')
    expect(ev.action_source).toBe('email')
    expect(ev.custom_data).toMatchObject({ currency: 'NZD', value: 500 })
  })
})

describe('发到哪里', () => {
  it('线索阶段事件发到线索阶段数据集，不发到网站像素', async () => {
    const { fetcher, urls } = fakeFetch(ok)
    await writer.send(writer.build(stage(), WITH_CRM), WITH_CRM, { fetcher })
    expect(urls[0]).toContain(`/${CRM_DATASET}/events`)
    expect(urls[0]).not.toContain(WEB_PIXEL)
  })

  it('成交仍发到网站像素', async () => {
    const { fetcher, urls } = fakeFetch(ok)
    const p = writer.build(
      stage({ outcomeKind: 'purchase', leadStage: null, amountMinor: 100, currency: 'NZD', actionSource: 'email' }),
      WITH_CRM,
    )
    await writer.send(p, WITH_CRM, { fetcher })
    expect(urls[0]).toContain(`/${WEB_PIXEL}/events`)
  })

  it('发送时数据集配置丢了 → 配置错误，一个请求都不发', async () => {
    const { fetcher } = fakeFetch(ok)
    const raw = await writer.send(writer.build(stage(), WITH_CRM), BASE, { fetcher })
    expect(raw).toMatchObject({ ok: false, errorName: 'ConfigError' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(writer.accept(raw).kind).toBe('permanent')
  })
})

describe('数据集编号误填成网站像素', () => {
  it('发送时按配置错误拦下，一个请求都不发', async () => {
    const { fetcher } = fakeFetch(ok)
    const wrong: ClientSendConfig = { ...BASE, crmStage: { datasetId: WEB_PIXEL, leadEventSource: 'Magic Engine' } }
    const raw = await writer.send(writer.build(stage(), wrong), wrong, { fetcher })
    expect(raw).toMatchObject({ ok: false, errorName: 'ConfigError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('预检', () => {
  it('配了线索阶段数据集 → 也确认令牌看得见它；看不见就预检不过', async () => {
    const { fetcher } = fakeFetch((url) => {
      if (url.includes('debug_token')) return new Response(JSON.stringify({ data: { is_valid: true, scopes: ['ads_management'] } }))
      if (url.includes(WEB_PIXEL)) return new Response(JSON.stringify({ id: WEB_PIXEL, name: 'web' }))
      return new Response(JSON.stringify({ error: { message: 'Unsupported get request' } }))
    })
    const pre = await writer.preflight(WITH_CRM, { fetcher })
    expect(pre.ok).toBe(false)
    expect(pre.detail).toMatchObject({ crm_dataset_visible: false })
  })

  it('看得见 → 预检通过', async () => {
    const { fetcher } = fakeFetch((url) => {
      if (url.includes('debug_token')) return new Response(JSON.stringify({ data: { is_valid: true, scopes: ['ads_management'] } }))
      if (url.includes(WEB_PIXEL)) return new Response(JSON.stringify({ id: WEB_PIXEL, name: 'web' }))
      return new Response(JSON.stringify({ id: CRM_DATASET, name: 'crm' }))
    })
    expect((await writer.preflight(WITH_CRM, { fetcher })).ok).toBe(true)
  })
})
