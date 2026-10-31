/**
 * GET / PATCH /api/clients/[id]/leads-config —— audience id 那一栏。
 *
 * ## 这个文件为什么存在
 *
 * 「Mailchimp 出口坏了」那条今日待办让 FDE「打开设置页确认 audience 配置」，
 * 可点进去**什么都改不了** —— 这个值此前只能改数据库。管道说了话，收到的人做
 * 不了事。2026-09-06 补上界面，这里钉的是界面背后那两个接口的契约。
 *
 * 钉得最紧的一条：**只改 audience 时，回给界面的其余几项必须照实回读**。拿
 * 「默认值」顶替会把「这次没读」变成「全都是关的」，界面照单全收就等于凭空把
 * 客户的开关显示成关闭 —— 正是这条链路刚修完的那类坑。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  readAudienceId: vi.fn(),
  writeAudienceId: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
  requireDashboardClientAccess: mocks.requirePaidClientAccess,
}))

vi.mock('@/lib/mailchimp/audience-config', () => ({
  readAudienceId: mocks.readAudienceId,
  writeAudienceId: mocks.writeAudienceId,
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { GET, PATCH } from '../route'

const CLIENT = 'client-cts'
const params = { params: { id: CLIENT } }

/** clients 表的读 / 写假件。记下每一次 update 写进去的东西。 */
function mockClients(leadsConfig: unknown, opts: { readError?: string } = {}) {
  const updates: Record<string, unknown>[] = []
  mocks.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve(
            opts.readError
              ? { data: null, error: { message: opts.readError } }
              : { data: { leads_config: leadsConfig }, error: null },
          ),
      }),
    }),
    update: (patch: Record<string, unknown>) => {
      updates.push(patch)
      return { eq: () => Promise.resolve({ error: null }) }
    },
  }))
  return updates
}

const patchReq = (body: unknown) =>
  new NextRequest('http://localhost/api/clients/x/leads-config', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePaidClientAccess.mockResolvedValue({ ok: true })
  mocks.readAudienceId.mockResolvedValue({ ok: true, audienceId: 'dda97b7e61' })
  mocks.writeAudienceId.mockResolvedValue({ ok: true, storedIn: 'leads_config' })
})

describe('GET', () => {
  it('audience id 交给 readAudienceId 决定读哪边，不自己从 leads_config 掏', async () => {
    // 专列 apply 之后权威值在专列上。界面自己去掏 jsonb 会显示一个出口早就
    // 不看的旧值 —— 看起来配好了，实际没生效。
    mockClients({ mailchimp_enabled: true, mailchimp_audience_id: 'stale-jsonb-value' })
    mocks.readAudienceId.mockResolvedValue({ ok: true, audienceId: 'from-column' })

    const res = await GET(new NextRequest('http://localhost/x'), params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.config.mailchimpAudienceId).toBe('from-column')
    expect(mocks.readAudienceId).toHaveBeenCalledWith(CLIENT)
  })

  it('audience 读失败 → 500，不把「读不到」显示成「没配」', async () => {
    mockClients({})
    mocks.readAudienceId.mockResolvedValue({ ok: false, message: 'connection reset' })

    const res = await GET(new NextRequest('http://localhost/x'), params)

    expect(res.status).toBe(500)
  })
})

describe('PATCH', () => {
  it('存 audience → 交给 writeAudienceId，并回显存进去的值', async () => {
    mockClients({ mailchimp_enabled: true })

    const res = await PATCH(patchReq({ mailchimpAudienceId: ' dda97b7e61 ' }), params)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.writeAudienceId).toHaveBeenCalledWith(CLIENT, 'dda97b7e61')
    expect(json.config.mailchimpAudienceId).toBe('dda97b7e61')
  })

  it('只改 audience 时，其余几项照实回读 —— 不许拿默认值顶替', async () => {
    // 顶替的后果：界面把「邮件反应同步」显示成关闭，用户一保存就真关了。
    mockClients({ mailchimp_enabled: true, trade_domains: ['hot.co.nz'] })

    const res = await PATCH(patchReq({ mailchimpAudienceId: 'dda97b7e61' }), params)
    const json = await res.json()

    expect(json.config.mailchimpEnabled).toBe(true)
    expect(json.config.tradeDomains).toEqual(['hot.co.nz'])
  })

  it('清空 → 合法，语义是关掉这个客户的出口', async () => {
    mockClients({})

    const res = await PATCH(patchReq({ mailchimpAudienceId: '' }), params)

    expect(res.status).toBe(200)
    expect(mocks.writeAudienceId).toHaveBeenCalledWith(CLIENT, '')
  })

  it('填了明显不对的东西（整段网址 / 名单名字）→ 400，别让出口每小时静默 404', async () => {
    mockClients({})

    for (const bad of ['https://us1.admin.mailchimp.com/lists/', 'CTS 主名单', 'dda 97b7e61']) {
      const res = await PATCH(patchReq({ mailchimpAudienceId: bad }), params)
      expect(res.status, bad).toBe(400)
    }
    expect(mocks.writeAudienceId).not.toHaveBeenCalled()
  })

  it('写失败 → 500，绝不回一个「保存成功」', async () => {
    mockClients({})
    mocks.writeAudienceId.mockResolvedValue({ ok: false, message: 'permission denied' })

    const res = await PATCH(patchReq({ mailchimpAudienceId: 'dda97b7e61' }), params)

    expect(res.status).toBe(500)
  })

  it('audience 跟别的项一起改 → 两边都存，互不覆盖', async () => {
    const updates = mockClients({ trade_domains: ['hot.co.nz'] })

    const res = await PATCH(
      patchReq({ mailchimpAudienceId: 'dda97b7e61', mailchimpEnabled: false }),
      params,
    )
    const json = await res.json()

    expect(mocks.writeAudienceId).toHaveBeenCalledWith(CLIENT, 'dda97b7e61')
    // jsonb 那次写只动 mailchimp_enabled，原有的 trade_domains 原样留着
    const jsonbWrite = updates.find((u) => 'leads_config' in u)
    expect(jsonbWrite?.leads_config).toMatchObject({
      mailchimp_enabled: false,
      trade_domains: ['hot.co.nz'],
    })
    expect(json.config.mailchimpAudienceId).toBe('dda97b7e61')
  })
})

describe('PATCH ownPhoneNumbers', () => {
  it('规范化成 E.164 再存，并且不覆盖已有的 ownEmailDomains', async () => {
    const updates = mockClients({ own_email_domains: ['example.test'], ownPhoneNumbers: [] })
    const res = await PATCH(patchReq({ ownPhoneNumbers: '+64 21 000 0000\n021 000 0001' }), params)
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
    expect(updates[0].leads_config).toMatchObject({
      own_email_domains: ['example.test'],
      ownPhoneNumbers: ['+64210000000', '+64210000001'],
    })
    const json = await res.json()
    expect(json.config.ownPhoneNumbers).toEqual(['+64210000000', '+64210000001'])
    expect(json.config.ownEmailDomains).toEqual(['example.test'])
  })

  it('填错 → 400，整项不存', async () => {
    const updates = mockClients({})
    const res = await PATCH(patchReq({ ownPhoneNumbers: '+64 21 000 0000\nnot a number' }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).rejected).toEqual(['not a number'])
    expect(updates).toHaveLength(0)
  })

  it('类型不对 → 400', async () => {
    mockClients({})
    expect((await PATCH(patchReq({ ownPhoneNumbers: 5 }), params)).status).toBe(400)
  })

  it('GET 回显 ownPhoneNumbers', async () => {
    mockClients({ ownPhoneNumbers: ['+64210000000'] })
    mocks.readAudienceId.mockResolvedValue({ ok: true, audienceId: '' })
    const res = await GET(new NextRequest('http://localhost/x'), params)
    expect((await res.json()).config.ownPhoneNumbers).toEqual(['+64210000000'])
  })
})

describe('own_email_domains 里的点名员工地址（WP-1a，魏征 P1）', () => {
  const STORED = { own_email_domains: ['ctstours.co.nz', 'op3@asiascapeholidays.com'], trade_domains: ['asiascapeholidays.com'] }

  it('GET 同时返回域名和点名地址', async () => {
    mockClients(STORED)
    const json = await (await GET(new NextRequest('http://localhost/x'), params)).json()
    expect(json.config.ownEmailDomains).toEqual(['ctstours.co.nz'])
    expect(json.config.ownAddresses).toEqual(['op3@asiascapeholidays.com'])
  })

  it('只保存域名框：已存的员工地址一个都不丢', async () => {
    const updates = mockClients(STORED)
    const res = await PATCH(patchReq({ ownEmailDomains: 'ctstours.co.nz\nchinatravel.co.nz' }), params)
    expect(res.status).toBe(200)
    const saved = (updates[0].leads_config as Record<string, unknown>).own_email_domains
    expect(saved).toEqual(['ctstours.co.nz', 'chinatravel.co.nz', 'op3@asiascapeholidays.com'])
  })

  it('保存地址框：地址原样保留（不退化成整个域名），域名不动', async () => {
    const updates = mockClients(STORED)
    const res = await PATCH(patchReq({ ownAddresses: 'Op3@AsiaScapeHolidays.com, op1@asiascapeholidays.com' }), params)
    expect(res.status).toBe(200)
    const saved = (updates[0].leads_config as Record<string, unknown>).own_email_domains as string[]
    expect(saved).toEqual(['ctstours.co.nz', 'op3@asiascapeholidays.com', 'op1@asiascapeholidays.com'])
    expect(saved).not.toContain('asiascapeholidays.com')
  })

  it('域名框里顺手打了完整邮箱 → 当精确地址存，不扩成整个域名', async () => {
    const updates = mockClients({ own_email_domains: ['ctstours.co.nz'] })
    await PATCH(patchReq({ ownEmailDomains: 'ctstours.co.nz\nop1@asiascapeholidays.com' }), params)
    const saved = (updates[0].leads_config as Record<string, unknown>).own_email_domains as string[]
    expect(saved).toEqual(['ctstours.co.nz', 'op1@asiascapeholidays.com'])
  })

  it('地址格式不对 → 退回，不存', async () => {
    const updates = mockClients({})
    const json = await (await PATCH(patchReq({ ownAddresses: 'not-an-email, ok@x.co.nz' }), params)).json()
    expect(json.rejected).toContain('not-an-email')
    expect((updates[0].leads_config as Record<string, unknown>).own_email_domains).toEqual(['ok@x.co.nz'])
  })

  it('Gmail 整域名塌缩：自家域名和同行域名里的 gmail.com / outlook.com / yahoo.co.nz 一律退回', async () => {
    const updates = mockClients({})
    const json = await (await PATCH(patchReq({ ownEmailDomains: 'gmail.com\nctstours.co.nz\noutlook.com', tradeDomains: 'yahoo.co.nz, hot.co.nz, icloud.com' }), params)).json()
    const saved = updates[0].leads_config as Record<string, unknown>
    expect(saved.own_email_domains).toEqual(['ctstours.co.nz'])
    expect(saved.trade_domains).toEqual(['hot.co.nz'])
    expect(json.rejected).toEqual(expect.arrayContaining(['gmail.com', 'outlook.com', 'yahoo.co.nz', 'icloud.com']))
  })

  it('读：库里已有的 gmail.com 整域名条目也不当自家域名', async () => {
    mockClients({ own_email_domains: ['gmail.com', 'ctstours.co.nz'] })
    const json = await (await GET(new NextRequest('http://localhost/x'), params)).json()
    expect(json.config.ownEmailDomains).toEqual(['ctstours.co.nz'])
  })
})

describe('PATCH 广告回传配置', () => {
  it('GET 回显四项，不把没填的显示成已经限制', async () => {
    mockClients({ mailchimp_enabled: true })
    mocks.readAudienceId.mockResolvedValue({ ok: true, audienceId: '' })
    const json = await (await GET(new NextRequest('http://localhost/x'), params)).json()
    expect(json.config.capiAllowedEvents).toBeNull()
    expect(json.config.capiDealMilestone).toBeNull()
    expect(json.config.capiQualifiedLeadStageKey).toBeNull()
    expect(json.config.capiDealStageKey).toBeNull()
  })

  it('保存四项时留下原来的邮件配置', async () => {
    const updates = mockClients({ trade_domains: ['hot.co.nz'], mailchimp_enabled: true })
    const res = await PATCH(
      patchReq({
        capiAllowedEvents: ['Purchase', 'BalancePaid'],
        capiDealMilestone: 'deposit',
        capiQualifiedLeadStageKey: 'quoted',
        capiDealStageKey: 'won',
      }),
      params,
    )
    expect(res.status).toBe(200)
    expect(updates[0].leads_config).toMatchObject({
      trade_domains: ['hot.co.nz'],
      mailchimp_enabled: true,
      capi_allowed_events: ['Purchase', 'BalancePaid'],
      capi_deal_milestone: 'deposit',
      capi_qualified_lead_stage_key: 'quoted',
      capi_deal_stage_key: 'won',
    })
  })

  it('留空会清掉键，而不是写成空名单', async () => {
    const updates = mockClients({
      capi_allowed_events: ['Purchase'],
      capi_deal_milestone: 'deposit',
      capi_deal_stage_key: 'won',
      trade_domains: ['hot.co.nz'],
    })
    const res = await PATCH(
      patchReq({
        capiAllowedEvents: null,
        capiDealMilestone: null,
        capiQualifiedLeadStageKey: null,
        capiDealStageKey: '',
      }),
      params,
    )
    expect(res.status).toBe(200)
    const saved = updates[0].leads_config as Record<string, unknown>
    expect(saved.trade_domains).toEqual(['hot.co.nz'])
    expect(saved.capi_allowed_events).toBeUndefined()
    expect(saved.capi_deal_milestone).toBeUndefined()
    expect(saved.capi_deal_stage_key).toBeUndefined()
    const json = await res.json()
    expect(json.config.capiAllowedEvents).toBeNull()
  })

  it('只改邮件开关时不动已经保存的名单', async () => {
    const updates = mockClients({ capi_allowed_events: ['Purchase'], trade_domains: ['hot.co.nz'] })
    const res = await PATCH(patchReq({ mailchimpEnabled: true }), params)
    expect(res.status).toBe(200)
    expect(updates[0].leads_config).toMatchObject({
      capi_allowed_events: ['Purchase'],
      mailchimp_enabled: true,
    })
  })

  it('认不出的事件名或阶段不保存', async () => {
    const updates = mockClients({ trade_domains: ['hot.co.nz'] })
    expect((await PATCH(patchReq({ capiAllowedEvents: ['ViewContent'] }), params)).status).toBe(400)
    expect((await PATCH(patchReq({ capiDealMilestone: 'won' }), params)).status).toBe(400)
    expect((await PATCH(patchReq({ capiDealStageKey: 'Won' }), params)).status).toBe(400)
    expect(updates).toHaveLength(0)
  })
})
