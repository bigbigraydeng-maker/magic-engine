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
